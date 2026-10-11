# GPU filtered-pixel investigation 

`baseline.json` reproduces the original 113/95 maxima; source crop RGBA restoration is exact.

The initial `array-nearest`, `array-mip`, `canvas-nearest` and `array-no-floor` runs are **invalid empty-image controls**, not parity successes. They exposed a fixture framebuffer-state dependency: `readRenderTargetPixels` restores the resolve framebuffer, whereas the subsequent render requires the multisample framebuffer. Shadow rendering previously masked the missing rebind. The diagnostic fixture now calls `setRenderTarget(target)` before every draw, checks that both candidates differ from an empty scene in more than 1,000 pixels, and checks shader diagnostics. Corrected runs use new filenames. The strict channel gate remains unchanged at ≤1.

That was the initial investigation checkpoint; final production changes and passing results are described in README.md. Do not use these diagnostic controls as performance measurements.
