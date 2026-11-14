use serde::Serialize;
use sha2::{Digest, Sha256};
use std::ffi::OsString;
use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

#[derive(Default)]
struct SelectedFolders(Mutex<Vec<PathBuf>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderEntry {
    relative_path: String,
    size: u64,
    hash: String,
    absolute_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderSelection {
    folder_path: String,
    exists: bool,
    entries: Vec<FolderEntry>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum ExternalRequest {
    Diff {
        left: PathBuf,
        right: PathBuf,
    },
    Merge {
        base: PathBuf,
        local: PathBuf,
        remote: PathBuf,
        merged: PathBuf,
    },
}

struct ExternalLaunchState {
    request: Option<ExternalRequest>,
    merge_saved: Arc<AtomicBool>,
    save_lock: Mutex<()>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalFileSnapshot {
    path: String,
    name: String,
    exists: bool,
    size: u64,
    last_modified_ms: Option<u64>,
    bytes: Vec<u8>,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum ExternalLaunchPayload {
    DiffFile {
        left: ExternalFileSnapshot,
        right: ExternalFileSnapshot,
    },
    DiffDirectory {
        left: FolderSelection,
        right: FolderSelection,
    },
    Merge {
        base: ExternalFileSnapshot,
        local: ExternalFileSnapshot,
        remote: ExternalFileSnapshot,
        merged: ExternalFileSnapshot,
    },
}

struct LoadedLaunch {
    payload: ExternalLaunchPayload,
    readable_folders: Vec<PathBuf>,
}

fn sha256_file(path: &PathBuf) -> Result<String, String> {
    let file = File::open(path).map_err(|error| format!("{}: {error}", path.display()))?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];

    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|error| format!("{}: {error}", path.display()))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }

    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn scan_folder(folder: &Path) -> Result<FolderSelection, String> {
    let mut entries = Vec::new();

    for entry in WalkDir::new(&folder).follow_links(false).min_depth(1) {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path().to_path_buf();
        let relative_path = path
            .strip_prefix(&folder)
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let size = entry.metadata().map_err(|error| error.to_string())?.len();
        let hash = sha256_file(&path)?;

        entries.push(FolderEntry {
            relative_path,
            size,
            hash,
            absolute_path: path.to_string_lossy().into_owned(),
        });
    }

    entries.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(FolderSelection {
        folder_path: folder.to_string_lossy().into_owned(),
        exists: true,
        entries,
    })
}

fn resolve_argument(argument: &OsString) -> Result<PathBuf, String> {
    if argument.is_empty() {
        return Ok(PathBuf::new());
    }
    let path = PathBuf::from(argument);
    if path.is_absolute() {
        Ok(path)
    } else {
        std::env::current_dir()
            .map(|directory| directory.join(path))
            .map_err(|error| format!("Cannot resolve relative path: {error}"))
    }
}

fn parse_launch_args(
    arguments: impl IntoIterator<Item = OsString>,
) -> Result<Option<ExternalRequest>, String> {
    // macOS may include an OS-generated process serial argument for .app launches.
    let args: Vec<OsString> = arguments
        .into_iter()
        .filter(|argument| !argument.to_string_lossy().starts_with("-psn_"))
        .collect();
    if args.is_empty() {
        return Ok(None);
    }
    match (args[0].to_str(), args.len()) {
        (Some("--diff"), 3) => Ok(Some(ExternalRequest::Diff {
            left: resolve_argument(&args[1])?,
            right: resolve_argument(&args[2])?,
        })),
        (Some("--merge"), 5) => {
            let merged = resolve_argument(&args[4])?;
            if merged.as_os_str().is_empty() {
                return Err("MERGED output path must not be empty".to_string());
            }
            Ok(Some(ExternalRequest::Merge {
                base: resolve_argument(&args[1])?,
                local: resolve_argument(&args[2])?,
                remote: resolve_argument(&args[3])?,
                merged,
            }))
        }
        _ => Err(
            "Usage: mgdiff [--diff <left> <right> | --merge <base> <local> <remote> <merged>]"
                .to_string(),
        ),
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ExternalPathKind {
    Missing,
    File,
    Directory,
}

fn path_kind(path: &Path) -> Result<ExternalPathKind, String> {
    if path.as_os_str().is_empty() {
        return Ok(ExternalPathKind::Missing);
    }
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => Ok(ExternalPathKind::File),
        Ok(metadata) if metadata.is_dir() => Ok(ExternalPathKind::Directory),
        Ok(_) => Err(format!("Unsupported file type: {}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(ExternalPathKind::Missing),
        Err(error) => Err(format!("{}: {error}", path.display())),
    }
}

fn read_external_file(path: &Path, label: &str) -> Result<ExternalFileSnapshot, String> {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| label.to_string());
    let display_path = path.to_string_lossy().into_owned();
    if path_kind(path)? == ExternalPathKind::Missing {
        return Ok(ExternalFileSnapshot {
            path: display_path,
            name,
            exists: false,
            size: 0,
            last_modified_ms: None,
            bytes: Vec::new(),
        });
    }
    let metadata = fs::metadata(path).map_err(|error| format!("{}: {error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("Expected a file: {}", path.display()));
    }
    let bytes = fs::read(path).map_err(|error| format!("{}: {error}", path.display()))?;
    let last_modified_ms = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX));
    Ok(ExternalFileSnapshot {
        path: display_path,
        name,
        exists: true,
        size: bytes.len() as u64,
        last_modified_ms,
        bytes,
    })
}

fn scan_external_folder(path: &Path) -> Result<(FolderSelection, Option<PathBuf>), String> {
    match path_kind(path)? {
        ExternalPathKind::Missing => {
            return Ok((
                FolderSelection {
                    folder_path: path.to_string_lossy().into_owned(),
                    exists: false,
                    entries: Vec::new(),
                },
                None,
            ));
        }
        ExternalPathKind::File => return Err(format!("Expected a directory: {}", path.display())),
        ExternalPathKind::Directory => {}
    }
    let canonical =
        fs::canonicalize(path).map_err(|error| format!("{}: {error}", path.display()))?;
    Ok((scan_folder(&canonical)?, Some(canonical)))
}

fn load_external_launch(request: &ExternalRequest) -> Result<LoadedLaunch, String> {
    match request {
        ExternalRequest::Diff { left, right } => {
            let left_kind = path_kind(left)?;
            let right_kind = path_kind(right)?;
            if left_kind == ExternalPathKind::Directory || right_kind == ExternalPathKind::Directory
            {
                if left_kind == ExternalPathKind::File || right_kind == ExternalPathKind::File {
                    return Err("Cannot compare a file with a directory".to_string());
                }
                let (left, left_root) = scan_external_folder(left)?;
                let (right, right_root) = scan_external_folder(right)?;
                Ok(LoadedLaunch {
                    payload: ExternalLaunchPayload::DiffDirectory { left, right },
                    readable_folders: left_root.into_iter().chain(right_root).collect(),
                })
            } else {
                Ok(LoadedLaunch {
                    payload: ExternalLaunchPayload::DiffFile {
                        left: read_external_file(left, "LOCAL")?,
                        right: read_external_file(right, "REMOTE")?,
                    },
                    readable_folders: Vec::new(),
                })
            }
        }
        ExternalRequest::Merge {
            base,
            local,
            remote,
            merged,
        } => Ok(LoadedLaunch {
            payload: ExternalLaunchPayload::Merge {
                base: read_external_file(base, "BASE")?,
                local: read_external_file(local, "LOCAL")?,
                remote: read_external_file(remote, "REMOTE")?,
                merged: read_external_file(merged, "MERGED")?,
            },
            readable_folders: Vec::new(),
        }),
    }
}

fn scan_selected_folder() -> Result<Option<(PathBuf, FolderSelection)>, String> {
    let Some(chosen_folder) = rfd::FileDialog::new().pick_folder() else {
        return Ok(None);
    };
    let folder = fs::canonicalize(&chosen_folder).map_err(|error| error.to_string())?;
    let selection = scan_folder(&folder)?;
    Ok(Some((folder, selection)))
}

#[tauri::command]
async fn pick_folder_entries(
    state: tauri::State<'_, SelectedFolders>,
) -> Result<Option<FolderSelection>, String> {
    let scanned = tauri::async_runtime::spawn_blocking(scan_selected_folder)
        .await
        .map_err(|error| error.to_string())??;
    let Some((folder, selection)) = scanned else {
        return Ok(None);
    };
    state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .push(folder);
    Ok(Some(selection))
}

#[tauri::command]
fn read_file_bytes(
    path: String,
    state: tauri::State<'_, SelectedFolders>,
) -> Result<Vec<u8>, String> {
    let resolved = fs::canonicalize(&path).map_err(|error| error.to_string())?;
    let is_allowed = state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .iter()
        .any(|folder| resolved.starts_with(folder));
    if !is_allowed {
        return Err("File is outside the selected folders".to_string());
    }
    if !resolved.is_file() {
        return Err("Selected path is not a file".to_string());
    }
    fs::read(resolved).map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_external_launch(
    state: tauri::State<'_, ExternalLaunchState>,
    folders: tauri::State<'_, SelectedFolders>,
) -> Result<Option<ExternalLaunchPayload>, String> {
    let Some(request) = state.request.clone() else {
        return Ok(None);
    };
    let loaded = tauri::async_runtime::spawn_blocking(move || load_external_launch(&request))
        .await
        .map_err(|error| error.to_string())??;
    if !loaded.readable_folders.is_empty() {
        let mut allowed = folders.0.lock().map_err(|error| error.to_string())?;
        for folder in loaded.readable_folders {
            if !allowed.contains(&folder) {
                allowed.push(folder);
            }
        }
    }
    Ok(Some(loaded.payload))
}

#[tauri::command]
fn save_external_merge(
    content: String,
    state: tauri::State<'_, ExternalLaunchState>,
) -> Result<(), String> {
    let ExternalRequest::Merge { merged, .. } = state
        .request
        .as_ref()
        .ok_or_else(|| "This launch is not a merge session".to_string())?
    else {
        return Err("This launch is not a merge session".to_string());
    };
    let _guard = state.save_lock.lock().map_err(|error| error.to_string())?;
    write_merge_result(merged, &content, &state.merge_saved)
}

fn write_merge_result(path: &Path, content: &str, saved: &AtomicBool) -> Result<(), String> {
    fs::write(path, content.as_bytes()).map_err(|error| format!("{}: {error}", path.display()))?;
    saved.store(true, Ordering::SeqCst);
    Ok(())
}

fn merge_exit_status(saved: bool) -> i32 {
    if saved {
        0
    } else {
        1
    }
}

#[tauri::command]
fn get_external_tool_path() -> Result<String, String> {
    std::env::current_exe()
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_text_file(suggested_name: String, content: String) -> Result<Option<String>, String> {
    let file_name = Path::new(&suggested_name)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("mgdiff.txt");
    let Some(path) = rfd::FileDialog::new().set_file_name(file_name).save_file() else {
        return Ok(None);
    };
    fs::write(&path, content).map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn save_binary_file(suggested_name: String, bytes: Vec<u8>) -> Result<Option<String>, String> {
    let file_name = Path::new(&suggested_name)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("mgdiff.bin");
    let Some(path) = rfd::FileDialog::new().set_file_name(file_name).save_file() else {
        return Ok(None);
    };
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let arguments: Vec<OsString> = std::env::args_os().skip(1).collect();
    if arguments.len() == 1 && arguments[0] == "--help" {
        println!(
            "Usage: mgdiff [--diff <left> <right> | --merge <base> <local> <remote> <merged>]"
        );
        return;
    }
    let request = match parse_launch_args(arguments) {
        Ok(request) => request,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    };
    let merge_mode = matches!(request, Some(ExternalRequest::Merge { .. }));
    let merge_saved = Arc::new(AtomicBool::new(false));
    let app = tauri::Builder::default()
        .manage(SelectedFolders::default())
        .manage(ExternalLaunchState {
            request,
            merge_saved: merge_saved.clone(),
            save_lock: Mutex::new(()),
        })
        .invoke_handler(tauri::generate_handler![
            pick_folder_entries,
            read_file_bytes,
            save_text_file,
            save_binary_file,
            get_external_launch,
            save_external_merge,
            get_external_tool_path
        ])
        .build(tauri::generate_context!())
        .expect("error while building MGDiff");

    if merge_mode {
        // Git can trust the process status only if it reflects an explicit save.
        let _ = app.run_return(|_, _| {});
        std::process::exit(merge_exit_status(merge_saved.load(Ordering::SeqCst)));
    } else {
        app.run(|_, _| {});
    }
}

#[cfg(test)]
mod tests {
    use super::{
        load_external_launch, merge_exit_status, parse_launch_args, scan_folder,
        write_merge_result, ExternalLaunchPayload, ExternalRequest,
    };
    use std::ffi::OsString;
    use std::fs;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn empty_folder_is_a_valid_selection() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let folder =
            std::env::temp_dir().join(format!("mgdiff-empty-{unique}-{}", std::process::id()));
        fs::create_dir(&folder).unwrap();
        let folder = fs::canonicalize(folder).unwrap();

        let selection = scan_folder(&folder).unwrap();
        assert_eq!(selection.folder_path, folder.to_string_lossy());
        assert!(selection.entries.is_empty());

        fs::remove_dir(folder).unwrap();
    }

    #[test]
    fn cli_paths_with_spaces_and_missing_base_are_preserved() {
        let args = [
            OsString::from("--merge"),
            OsString::new(),
            OsString::from("local version.txt"),
            OsString::from("remote version.txt"),
            OsString::from("merged result.txt"),
        ];
        let parsed = parse_launch_args(args).unwrap().unwrap();
        let ExternalRequest::Merge {
            base,
            local,
            remote,
            merged,
        } = parsed
        else {
            panic!("Expected merge request");
        };
        assert!(base.as_os_str().is_empty());
        assert!(local.ends_with("local version.txt"));
        assert!(remote.ends_with("remote version.txt"));
        assert!(merged.ends_with("merged result.txt"));
        assert!(merged.is_absolute());
        assert!(parse_launch_args([OsString::from("--diff"), OsString::from("one")]).is_err());
        assert!(parse_launch_args([
            OsString::from("--merge"),
            OsString::new(),
            OsString::new(),
            OsString::new(),
            OsString::new(),
        ])
        .is_err());
    }

    #[test]
    fn external_diff_loads_files_and_missing_input() {
        let folder = std::env::temp_dir().join(format!("mgdiff-cli-file-{}", std::process::id()));
        fs::create_dir_all(&folder).unwrap();
        let left = folder.join("file with space.txt");
        let right = folder.join("missing file.txt");
        fs::write(&left, b"hello").unwrap();
        let loaded = load_external_launch(&ExternalRequest::Diff {
            left: left.clone(),
            right,
        })
        .unwrap();
        let ExternalLaunchPayload::DiffFile {
            left: left_snapshot,
            right: right_snapshot,
        } = loaded.payload
        else {
            panic!("Expected file diff");
        };
        assert_eq!(left_snapshot.bytes, b"hello");
        assert!(left_snapshot.exists);
        assert!(!right_snapshot.exists);
        assert!(right_snapshot.bytes.is_empty());
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn external_directory_loads_entries_and_missing_side() {
        let folder = std::env::temp_dir().join(format!("mgdiff-cli-dir-{}", std::process::id()));
        fs::create_dir_all(folder.join("nested folder")).unwrap();
        fs::write(folder.join("nested folder").join("note.txt"), b"hello").unwrap();
        let loaded = load_external_launch(&ExternalRequest::Diff {
            left: folder.clone(),
            right: folder.with_extension("missing"),
        })
        .unwrap();
        let ExternalLaunchPayload::DiffDirectory { left, right } = loaded.payload else {
            panic!("Expected directory diff");
        };
        assert!(left.exists);
        assert_eq!(left.entries.len(), 1);
        assert_eq!(left.entries[0].relative_path, "nested folder/note.txt");
        assert!(!right.exists);
        assert!(right.entries.is_empty());
        assert_eq!(loaded.readable_folders.len(), 1);
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn merge_reads_initial_result_and_only_writes_configured_target() {
        let folder = std::env::temp_dir().join(format!("mgdiff-cli-merge-{}", std::process::id()));
        fs::create_dir_all(&folder).unwrap();
        let local = folder.join("local.txt");
        let remote = folder.join("remote.txt");
        let merged = folder.join("merged.txt");
        fs::write(&local, "local").unwrap();
        fs::write(&remote, "remote").unwrap();
        fs::write(&merged, "<<<<<<< local\n=======\n>>>>>>> remote\n").unwrap();
        let loaded = load_external_launch(&ExternalRequest::Merge {
            base: std::path::PathBuf::new(),
            local: local.clone(),
            remote: remote.clone(),
            merged: merged.clone(),
        })
        .unwrap();
        let ExternalLaunchPayload::Merge {
            base,
            merged: initial,
            ..
        } = loaded.payload
        else {
            panic!("Expected merge launch");
        };
        assert!(!base.exists);
        assert!(String::from_utf8(initial.bytes)
            .unwrap()
            .starts_with("<<<<<<<"));
        let saved = AtomicBool::new(false);
        assert_eq!(merge_exit_status(saved.load(Ordering::SeqCst)), 1);
        write_merge_result(&merged, "resolved\n", &saved).unwrap();
        assert_eq!(fs::read_to_string(&merged).unwrap(), "resolved\n");
        assert_eq!(fs::read_to_string(&local).unwrap(), "local");
        assert_eq!(fs::read_to_string(&remote).unwrap(), "remote");
        assert_eq!(merge_exit_status(saved.load(Ordering::SeqCst)), 0);
        fs::remove_dir_all(folder).unwrap();
    }
}
