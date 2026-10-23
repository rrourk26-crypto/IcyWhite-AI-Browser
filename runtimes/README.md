# IcyWhite local inference runtimes

Runtime binaries are intentionally excluded from the ordinary Git source
repository because the Windows runtime payload is large.

The Windows build configuration expects runtime assets under:
- runtimes/
- llama/

Before building a distributable Windows application, obtain the appropriate
CPU, Vulkan, and/or NVIDIA CUDA runtime files and place them in the expected
directory structure.

Do not commit model weights, node_modules, dist output, or large runtime DLLs
to ordinary Git. The application build and runtime preparation steps must be
followed before producing a distributable release.
