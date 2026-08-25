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
// nothing gets painted. Verified directly on the affected hardware (Intel
// HD 530 + NVIDIA Quadro M1000M via nouveau) that the production frontend
// bundle itself is fine — it renders correctly over plain HTTP in a
// browser — so the gap is purely WebKitGTK/Mesa's own GL/EGL path here, not
// app content. LIBGL_ALWAYS_SOFTWARE forces Mesa's software rasterizer for
// every GL call, sidestepping both GPU drivers entirely — that's what
// actually gets real pixels on screen. This does cost the Graph view's
// WebGL rendering some speed on affected hardware, an acceptable trade for
// "works at all"; a user with a known-good GPU setup can export any of
// these themselves before launch (e.g. `LIBGL_ALWAYS_SOFTWARE=0`) to opt
// back into hardware acceleration.
#[cfg(target_os = "linux")]
const LINUX_COMPAT_ENV: [(&str, &str); 3] = [
    ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
    ("WEBKIT_DISABLE_COMPOSITING_MODE", "1"),
    ("LIBGL_ALWAYS_SOFTWARE", "1"),
];

fn main() {
    // `std::env::set_var` here and simply continuing in the same process
    // isn't enough: Mesa reads LIBGL_ALWAYS_SOFTWARE (and WebKitGTK reads at
    // least one of the other two) while the dynamic linker is still loading
    // this process's shared libraries — before our own `main` gets to run
    // any code at all. That's too late for an in-process set_var to matter,
    // which is exactly why a build with only that approach still shipped
    // with a blank window on the affected hardware despite the variables
    // technically being "set" by the time our code checked them.
    //
    // Re-exec ourselves instead: a freshly started process sees these in
    // its environment from the very beginning, the same as if the caller
    // had exported them. This recurses at most once — the second time
    // through, every variable above is already present (inherited from the
    // exec below) and this whole block is skipped.
    #[cfg(target_os = "linux")]
    if LINUX_COMPAT_ENV.iter().any(|(key, _)| std::env::var_os(key).is_none()) {
        use std::os::unix::process::CommandExt;
        let exe = std::env::current_exe().expect("failed to resolve our own executable path");
        let mut cmd = std::process::Command::new(exe);
        cmd.args(std::env::args_os().skip(1));
        for (key, value) in LINUX_COMPAT_ENV {
            if std::env::var_os(key).is_none() {
                cmd.env(key, value);
            }
        }
        // Only returns on failure — success replaces this process outright.
        let err = cmd.exec();
        panic!("failed to re-exec with a Linux-compatible graphics environment: {err}");
    }

    nodus_desktop_lib::run()
}
