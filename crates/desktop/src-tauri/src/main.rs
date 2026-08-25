// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// WebKitGTK's DMA-BUF renderer (default since ~2.42) fails to create a
// surfaceless EGL context on several common Linux setups — notably hybrid
// Intel/NVIDIA laptops running the open-source `nouveau` driver under
// Wayland — aborting the whole process before any window ever appears
// ("Could not create surfaceless EGL display: EGL_BAD_ALLOC"). Disabling
// just the DMA-BUF path stops the abort but on the same affected systems
// still leaves a blank white window: WebKitGTK keeps routing some GL calls
// through the broken discrete GPU driver even with compositing disabled, so
// nothing gets painted. LIBGL_ALWAYS_SOFTWARE forces Mesa's software
// rasterizer for every GL call, sidestepping both GPU drivers entirely.
// GDK_BACKEND=x11 avoids a separate, known WebKitGTK crash on the native
// Wayland backend (tauri-apps/tauri#8541). This costs the Graph view's WebGL
// rendering some speed on affected hardware, an acceptable trade for "works
// at all"; a user with known-good GPU setup can export any of these
// themselves before launch to opt back into hardware acceleration/Wayland.
#[cfg(target_os = "linux")]
const LINUX_COMPAT_ENV: [(&str, &str); 4] = [
    ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
    ("WEBKIT_DISABLE_COMPOSITING_MODE", "1"),
    ("LIBGL_ALWAYS_SOFTWARE", "1"),
    ("GDK_BACKEND", "x11"),
];

// On the same affected hardware, the AppImage's *bundled* WebKitGTK/GTK
// still renders a persistently blank window even with every flag above set
// correctly — but the exact same frontend, resolved against the host's own
// system webkit2gtk-4.1 package instead, renders fine. The AppImage's own
// launcher (linuxdeploy's GTK hook) points these at its bundled module/
// loader caches; clearing them lets GTK fall back to its compiled-in system
// search paths, matching what a plain .deb/.rpm install already does.
#[cfg(target_os = "linux")]
const LINUX_BUNDLE_MODULE_ENV: [&str; 7] = [
    "GTK_PATH",
    "GTK_IM_MODULE_FILE",
    "GDK_PIXBUF_MODULE_FILE",
    "GIO_EXTRA_MODULES",
    "GSETTINGS_SCHEMA_DIR",
    "GTK_DATA_PREFIX",
    "GTK_EXE_PREFIX",
];

#[cfg(target_os = "linux")]
const RELAUNCHED_MARKER: &str = "NODUS_LINUX_GFX_RELAUNCHED";

// Only worth preferring the system copy if it's actually there — on a
// minimal/immutable distro without GTK installed, the whole point of
// bundling is to still work, so this leaves the bundle alone in that case.
#[cfg(target_os = "linux")]
fn system_webkit_lib_dir() -> Option<&'static str> {
    ["/usr/lib/x86_64-linux-gnu", "/usr/lib64", "/usr/lib"]
        .into_iter()
        .find(|dir| {
            std::path::Path::new(dir)
                .join("libwebkit2gtk-4.1.so.0")
                .exists()
        })
}

fn main() {
    // `std::env::set_var` here and simply continuing in the same process
    // isn't enough: Mesa reads LIBGL_ALWAYS_SOFTWARE (and WebKitGTK reads at
    // least one of the other two) while the dynamic linker is still loading
    // this process's shared libraries — before our own `main` gets to run
    // any code at all. Re-exec ourselves instead: a freshly started process
    // sees these in its environment from the very beginning, the same as if
    // the caller had exported them.
    //
    // The AppImage's own launcher chain (AppRun → a small linuxdeploy stub
    // called AppRun.wrapped, which finally execs the real binary here) sets
    // LD_LIBRARY_PATH itself right before that last exec, unconditionally
    // *prepending* its bundle's lib dir onto whatever it inherited — so
    // setting LD_LIBRARY_PATH any earlier in that chain gets overridden
    // regardless. Overriding it here instead, in our own re-exec via
    // `Command::env` (which replaces the variable outright rather than
    // prepending to it), is what actually sticks.
    //
    // Guarded by a marker instead of "is everything already set", so this
    // runs exactly once regardless of what the ambient environment already
    // contains.
    #[cfg(target_os = "linux")]
    if std::env::var_os(RELAUNCHED_MARKER).is_none() {
        use std::os::unix::process::CommandExt;
        let exe = std::env::current_exe().expect("failed to resolve our own executable path");
        let mut cmd = std::process::Command::new(exe);
        cmd.args(std::env::args_os().skip(1));
        cmd.env(RELAUNCHED_MARKER, "1");
        for (key, value) in LINUX_COMPAT_ENV {
            if std::env::var_os(key).is_none() {
                cmd.env(key, value);
            }
        }
        // AppImage's own launcher chain (see above) already sets
        // LD_LIBRARY_PATH by the time we get here, so checking whether it's
        // set is useless for detecting a real user override — it's always
        // set for that case. Prepend instead: our preferred dir wins the
        // search, but anything only the bundle carries (e.g. GStreamer
        // plugins) is still reachable afterward, and a real user addition
        // is preserved rather than clobbered.
        if let Some(dir) = system_webkit_lib_dir() {
            let existing = std::env::var("LD_LIBRARY_PATH").unwrap_or_default();
            let new_value = if existing.is_empty() {
                dir.to_string()
            } else {
                format!("{dir}:{existing}")
            };
            cmd.env("LD_LIBRARY_PATH", new_value);
            for key in LINUX_BUNDLE_MODULE_ENV {
                cmd.env_remove(key);
            }
        }
        // Only returns on failure — success replaces this process outright.
        let err = cmd.exec();
        panic!("failed to re-exec with a Linux-compatible graphics environment: {err}");
    }

    nodus_desktop_lib::run()
}
