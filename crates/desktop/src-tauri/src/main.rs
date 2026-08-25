// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's DMA-BUF renderer (default since ~2.42) fails to create a
    // surfaceless EGL context on several common Linux setups — notably
    // hybrid Intel/NVIDIA laptops running the open-source `nouveau` driver
    // under Wayland — aborting the whole process before any window ever
    // appears ("Could not create surfaceless EGL display: EGL_BAD_ALLOC").
    // Disabling just the DMA-BUF path stops the abort but on the same
    // affected systems still left a blank white window: WebKitGTK kept
    // routing some GL calls through the broken discrete GPU driver even
    // with compositing disabled, so nothing ever got painted. Verified
    // directly on the affected hardware (Intel HD 530 + NVIDIA Quadro
    // M1000M via nouveau) that the production frontend bundle itself was
    // fine — it rendered correctly over plain HTTP in a browser — so the
    // gap was purely WebKitGTK's own GL/EGL path here, not app content.
    // LIBGL_ALWAYS_SOFTWARE forces Mesa's software rasterizer for every GL
    // call, sidestepping both GPU drivers entirely; that's what actually
    // got real pixels on screen. This does cost the Graph view's WebGL
    // rendering some speed on affected hardware — an acceptable trade for
    // "works at all" — so each var only fills in a default: a user with a
    // known-good GPU setup can export any of these themselves before
    // launch (e.g. `LIBGL_ALWAYS_SOFTWARE=0`) to opt back into hardware
    // acceleration without patching the binary. Safe to set here: this is
    // the first line of `main`, before any other thread exists to race on
    // the environment.
    #[cfg(target_os = "linux")]
    for (key, value) in [
        ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
        ("WEBKIT_DISABLE_COMPOSITING_MODE", "1"),
        ("LIBGL_ALWAYS_SOFTWARE", "1"),
    ] {
        if std::env::var_os(key).is_none() {
            unsafe { std::env::set_var(key, value) };
        }
    }

    nodus_desktop_lib::run()
}
