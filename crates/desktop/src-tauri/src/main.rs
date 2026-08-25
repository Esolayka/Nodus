// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's DMA-BUF renderer (default since ~2.42) fails to create a
    // surfaceless EGL context on several common Linux setups — notably
    // hybrid Intel/NVIDIA laptops running the open-source `nouveau` driver
    // under Wayland — aborting the whole process before any window ever
    // appears ("Could not create surfaceless EGL display: EGL_BAD_ALLOC").
    // Disabling it falls back to WebKitGTK's older, far more broadly
    // compatible EGL path. Safe to set here: this is the first line of
    // `main`, before any other thread exists to race on the environment.
    #[cfg(target_os = "linux")]
    unsafe {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    nodus_desktop_lib::run()
}
