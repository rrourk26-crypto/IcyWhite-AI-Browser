# ❄️ IcyWhite 2.0

**An open-source, local-first AI browser and Windows desktop workspace built around local AI, agentic tools, automation, voice interaction, and direct access to your workspace.**

> Formerly known as Oasis Agentic Browser.

IcyWhite is an open-source browser and desktop workspace designed to bring web browsing, local AI models, Windows tools, applications, files, media, development projects, and personal utilities together in one environment.

Built with **Electron, JavaScript, HTML, and CSS**, IcyWhite combines the flexibility of web technologies with Windows desktop capabilities and support for locally hosted AI.

The project has evolved through experiments with local models, browser tools, application integrations, runtime management, and AI-assisted workflows.

The goal is simple:

> **Your browser. Your AI. Your computer. Your workspace. Your control.**

---

## 📸 Screenshots

### Oasis Agentic Browser

![Oasis Agentic Browser](screenshots/main.png)

### Web Browsing

![Oasis browsing Google](screenshots/google.png)

![Oasis browsing GitHub](screenshots/github.png)

### Projects & Files

![Oasis Project Folder](screenshots/project%20folder.png)

### Agentic Tools

![Oasis Working](screenshots/WORKING.png)

![Oasis Agent Tools](screenshots/WORKING1.png)

### Screen Sharing

![Oasis Screen Sharing](screenshots/SCREENSHARE.png)

---

### IcyWhite Browser

![IcyWhite Browser](screenshots/main.png)

### Web Browsing

![IcyWhite browsing Google](screenshots/google.png)

![IcyWhite browsing GitHub](screenshots/github.png)

### Projects and Files

![IcyWhite Project Folder](screenshots/project%20folder.png)

### AI and Developer Tools

![IcyWhite AI Tools](screenshots/WORKING1.png)

### Screen Sharing

![IcyWhite Screen Sharing](screenshots/SCREENSHARE.png)

*Replace legacy Oasis screenshots with current IcyWhite screenshots where the interface has changed.*

---

# ✨ What Is IcyWhite?

IcyWhite is more than a traditional web browser.

It is designed as a central workspace for browsing, local AI, development, and computer-based tasks.

The project includes components for:

- Web browsing and tab management
- Local AI and configurable model connections
- Bundled llama.cpp runtime support
- CPU, Vulkan, and NVIDIA CUDA inference options
- Hugging Face model discovery and management
- Voice commands and speech-related tools
- Model Context Protocol (MCP) integrations
- Retrieval-augmented generation (RAG)
- Local AI memory components
- Windows commands and utilities
- Local HTML and JavaScript applications
- File and project workflows
- ZIP and archive-related workflows
- Screen capture and sharing integrations
- Media and browser-supported hardware access
- Web research and source tools
- Password-management components
- Debug logging and developer tools
- Customizable themes and settings
- Automated tests for selected components

The aim is to bring these capabilities into one adaptable environment rather than forcing every workflow into a separate application.

---

# 🪟 Windows Integration

IcyWhite is a Windows desktop application built with Electron.

Depending on the feature and its implementation, Electron applications can interact with local files, launch processes, communicate with local services, and use Windows utilities.

Common Windows commands include:

```text
ipconfig
ping
tracert
nslookup
tasklist
taskkill
systeminfo
hostname
whoami
netstat
dir
cd
mkdir
copy
move
del
ren
start
where
tree
```

These are examples of Windows commands, not a guarantee that every command is directly exposed through every IcyWhite interface.

Windows integration is intended to support a flexible environment for development, troubleshooting, local AI, and personal productivity.

**Security matters:** commands that modify files, launch processes, or change system settings should be handled carefully. Never execute untrusted AI-generated commands without reviewing them.

---

# 🤖 Local AI

Local AI is one of the central goals of IcyWhite.

Rather than requiring every AI interaction to go through a cloud service, IcyWhite supports connecting to local AI servers and includes runtime-management components for running compatible models on the user's own hardware.

The project has previously been tested with LM Studio using its OpenAI-compatible API.

## 🔌 LM Studio

The previously tested local endpoint is:

```text
http://localhost:1234/v1
```

LM Studio can expose a local model through an API that compatible applications can use.

The general connection looks like this:

```text
IcyWhite
    |
    v
OpenAI-compatible API
    |
    v
LM Studio
    |
    v
Local AI model
    |
    v
Your computer
```

The API format does not mean the model must run on OpenAI's cloud. A compatible local server can provide the interface while inference happens on the user's machine.

The endpoint above is the previously tested LM Studio configuration. Other backends require their own appropriate configuration.

## 🧠 Local Model Freedom

IcyWhite is designed to support flexibility in:

- Which model is used
- Where inference happens
- Which compatible AI server is connected
- Which local runtime is selected
- How much processing is assigned to the CPU or GPU
- Which AI tools and integrations are enabled
- How the workspace is customized

Previously tested model configurations include:

- Google Gemma models, including Gemma 4
- Qwen-family models, including Qwen vision-language configurations
- Other models compatible with the selected local inference server

Model compatibility depends on the server, model architecture, quantization, context requirements, available memory, and hardware.

The exact models available to a user depend on what they download and configure.

## 🌐 Cloud AI and Compatible APIs

IcyWhite can also connect to compatible external APIs when configured to do so.

Cloud AI and local AI are different operating modes. External providers may receive prompts and other data sent to their services.

The goal is not to lock users into a single AI provider or model. Users should be able to choose the approach that fits their hardware, privacy requirements, and workflow.

---

# ⚡ Built-In llama.cpp Runtime Support

IcyWhite includes runtime-management components intended to support local inference through llama.cpp.

The project organizes runtime files by backend.

| Runtime | Purpose |
|---|---|
| CPU | Local inference using the processor |
| Vulkan | GPU acceleration through Vulkan-compatible hardware |
| NVIDIA CUDA | GPU acceleration on compatible NVIDIA hardware |

The runtime directories currently include:

```text
runtimes/
├── llama-cpu/
├── llama-vulkan-x64/
└── llama.cpp-GPU-NVIDIA CUDA/
```

The exact contents can vary by build.

The intended benefit is to give IcyWhite a path toward running local models without requiring LM Studio or another external model-server application for every workflow.

Runtime selection and model execution still depend on the available binaries, drivers, hardware, model compatibility, and application configuration.

## 💻 CPU Runtime

The CPU backend provides a route for running compatible models without requiring a supported GPU backend.

CPU inference can be useful on systems without compatible GPU acceleration, although performance depends heavily on the processor, memory, and model size.

## 🎮 Vulkan Runtime

The Vulkan backend provides GPU acceleration on compatible hardware.

Performance and compatibility depend on the graphics device, installed drivers, and the particular runtime build.

## 🟢 NVIDIA CUDA Runtime

The CUDA backend targets compatible NVIDIA GPUs.

It requires compatible NVIDIA hardware, drivers, and the correct supporting CUDA libraries.

**Large binary note:** Some CUDA DLLs are intentionally excluded from the Git repository because of GitHub's individual file-size restrictions. In particular, `cublasLt64_12.dll` and `ggml-cuda.dll` are not included in the committed repository version.

Users who need these files must obtain compatible copies from a trusted distribution and place them in the appropriate runtime directory. Do not assume every runtime folder is complete immediately after cloning the repository.

---

# 🤗 Hugging Face and Model Management

IcyWhite includes Hugging Face model-management components.

These are intended to make discovering, managing, and working with compatible models more convenient from within the application.

Model-management functionality is designed around workflows such as:

- Discovering available models
- Reviewing model information
- Managing local model resources
- Preparing models for local inference
- Connecting compatible models to the appropriate runtime

Model downloads can be large. Check available disk space, model requirements, and hardware compatibility before downloading.

A model's presence on Hugging Face does not guarantee that it will run correctly on every computer.

---

# 🎙️ Voice and Speech Tools

IcyWhite 2.0 includes a collection of voice-related components intended to make the workspace more interactive.

These include:

- Microphone-input components
- Speech-to-text integration
- Voice commands
- Browser and application command handling
- Wake-word components
- Text-to-speech integration points
- Voice-related help and configuration interfaces

Voice workflows can connect speech input with AI interaction and application actions, depending on the configured backend and the functionality available in the current build.

Some voice features may require separate speech-recognition or speech-synthesis models, services, permissions, or additional configuration.

**Known limitation:** Microphone and live-chat behavior must be verified against the current build. Older Oasis versions had microphone and live-chat problems, so those historical instructions should not be assumed to describe IcyWhite 2.0 accurately.

For Windows microphone troubleshooting, check:

**Windows Settings → Privacy & security → Microphone**

Also check:

**Windows Settings → System → Sound → Input**

Make sure the intended microphone is selected and that the necessary permissions are enabled.

---

# 🧰 MCP and AI Tool Integration

IcyWhite includes Model Context Protocol (MCP)-related components.

MCP provides a standard approach for connecting compatible AI clients with external tools and services.

The project's MCP-related components provide a foundation for expanding AI tool access and integrating additional capabilities into the workspace.

Depending on the configured integration, tools can potentially provide access to information or actions beyond a basic text conversation.

Only connect trusted MCP servers and review the permissions and actions they expose. Tool access can have consequences beyond the chat itself.

---

# 📚 RAG and Local AI Memory

IcyWhite includes components for retrieval-augmented generation (RAG) and AI memory workflows.

RAG can help an AI system retrieve relevant information from a collection of documents or other indexed content before generating a response.

Memory-related components are intended to support workflows that benefit from retaining or retrieving relevant information across interactions.

These capabilities depend on their configuration, data sources, indexing behavior, and the connected model.

They should not be assumed to provide perfect recall or automatically understand every file in a workspace.

---

# 📁 Shared Workspace and Projects

IcyWhite is designed to provide a common environment for projects, files, and local applications.

A workspace can contain resources such as:

- HTML applications
- JavaScript and CSS
- Images and other media
- Documents
- Games
- AI projects
- Development projects
- Utilities
- ZIP archives
- Personal files
- Experimental applications

The goal is to make it easier to organize projects and integrate compatible local tools into one environment.

**Your workspace is yours.**

Keep backups of important files, especially when using tools that can edit, move, or delete local content.

---

# 📦 ZIP Files and Archives

IcyWhite's project workflows include ZIP and archive-related support.

Archives are useful for transferring projects, organizing groups of files, and distributing collections of resources.

The exact import, extraction, and file-management operations available depend on the current implementation.

Only open archives from sources you trust, and review extracted content before running scripts or executables.

---

# 🌐 Web and Local Applications

IcyWhite brings ordinary web browsing together with the possibility of working with local applications.

Compatible projects can use web technologies such as:

- HTML
- CSS
- JavaScript
- Images
- Browser APIs
- Local services
- Other supported resources

Examples of potential workspace applications include:

- AI interfaces
- Dashboards
- Utilities
- Media interfaces
- Productivity tools
- Games
- Personal websites
- Developer tools
- Experimental applications

The objective is to make the browser a flexible platform for more than visiting websites.

---

# 🖥️ Screen Sharing, Webcam, and Media

IcyWhite can use Electron and browser media APIs for supported media and capture workflows.

Depending on the feature, operating system, and permissions, these APIs can provide access to:

- Webcam and camera devices
- Microphones
- Screen capture
- Application windows
- Desktop screens
- Browser media
- Other supported media devices

Not every capability is available in every build, and permission requirements vary.

Grant access only to applications and services you trust.

---

# 🔐 Password Manager Components

IcyWhite 2.0 includes password-management interface and supporting code components.

The presence of these components should not be interpreted as proof that the password manager has undergone a security audit or is suitable for storing production credentials.

Before relying on it for sensitive information, verify its encryption, credential storage, key handling, access controls, and recovery behavior.

Security-sensitive features should be evaluated separately from ordinary user-interface functionality.

---

# 🎨 Themes and Customization

IcyWhite includes theme and settings components intended to make the workspace more personal.

Customization includes light and dark interface styles, theme-related settings, and support for additional color adjustments.

The broader goal is to let users adapt the interface to their preferences rather than requiring everyone to use the same appearance.

The project can also be modified at the source level to change interface components, behavior, and application integrations.

---

# 🛠️ Developer Tools and Diagnostics

IcyWhite includes developer-oriented components and automated tests for selected functionality.

The repository includes areas for:

- Debug logging
- Network and service-related logging
- AI and model management
- Voice-related features
- MCP tools
- RAG components
- Password-management code
- Browser and workspace utilities
- Automated tests

These tools support development and troubleshooting.

The presence of tests does not mean every feature, backend, runtime, or hardware configuration has been tested.

---

# 🏗️ Built with Electron

IcyWhite is built with Electron, combining web technologies with desktop application capabilities.

The project uses technologies including:

- Electron
- HTML
- CSS
- JavaScript
- Node.js
- Electron APIs
- Windows integrations
- Local AI services
- llama.cpp runtime binaries
- Browser and web APIs

This makes IcyWhite both a browser environment and a Windows desktop workspace.

---

# 🚀 Building IcyWhite

Anyone can clone the source, inspect it, modify it, and create their own build.

## Requirements

- Windows 10 or Windows 11
- Node.js
- npm
- Git, recommended

Additional requirements depend on the selected AI backend and runtime.

## 📥 Install Dependencies

Clone the repository:

```powershell
git clone https://github.com/rrourk26-crypto/IcyWhite-AI-Browser.git
cd IcyWhite-AI-Browser
```

Install the dependencies:

```powershell
npm install
```

## ▶️ Run IcyWhite from Source

```powershell
npm start
```

This launches the Electron application using the project's configured development start command.

## 🧪 Development Workflow

A basic workflow is:

```powershell
npm install
npm start
```

Make changes to the source code, then run the relevant application workflows to verify your changes.

If you modify code covered by automated tests, run the relevant tests as part of development.

## 🧪 Automated Tests

The repository includes tests for selected components.

If the project's `package.json` defines the test script, run:

```powershell
npm test
```

The exact coverage depends on the available tests and configured test runner.

## 🏗️ Build for Windows

If supported by the current package configuration, build the Windows application with:

```powershell
npm run build:win
```

A portable build may also be available through:

```powershell
npm run build:portable
```

The actual commands depend on the scripts configured in `package.json`.

Generated artifacts are normally written to:

```text
dist/
```

The exact output files depend on the build configuration.

---

# 📦 Runtime and Distribution Notes

The Git repository contains source code and selected runtime binaries. It is not necessarily a complete, self-contained distribution for every hardware configuration.

Before distributing a build:

1. Confirm that the required runtime files are present.
2. Confirm that the selected CPU, Vulkan, or CUDA backend is compatible with the target computer.
3. Verify that required model files and supporting libraries are available.
4. Check the packaging configuration and generated application resources.
5. Test the intended build on a clean environment before describing it as ready for general use.

Large model weights should generally be distributed separately from the source repository.

Large runtime libraries may require an external distribution method or Git LFS if they are to be shared through version control.

---

# 🔀 Fork IcyWhite

IcyWhite is intended to be a foundation people can adapt to their own needs.

You can:

- Fork the repository
- Modify the source
- Customize the interface
- Change the application name and icon
- Add or remove workspace applications
- Add AI providers or compatible local servers
- Extend runtime management
- Build new tools and integrations
- Customize themes and settings
- Experiment with new workflows
- Share your modifications

A fork does not have to remain identical to the original project.

The goal is to give developers and users a foundation they can understand, change, and build upon.

---

# 🔮 Future Development

IcyWhite is an evolving project.

Possible areas of future development include:

- Expanded local AI support
- Additional runtime and hardware compatibility
- Improved voice workflows
- More agentic tool integrations
- Better file and project management
- Additional browser utilities
- Expanded offline capabilities
- Improved model discovery and setup
- More customization
- Additional developer tools
- More robust security and permission controls

Future features depend on development, testing, and hardware compatibility. Planned functionality should not be treated as available until it has been implemented and verified.

---

# 🌱 Project Philosophy

IcyWhite is built around a simple idea:

> **Your computer should belong to you.**

Your files should be accessible.

Your applications should be customizable.

Your AI should have the option to run locally.

Your workspace should adapt to you.

Your tools should be understandable and configurable.

And the software itself should be something you can inspect, modify, rebuild, and share.

IcyWhite brings these ideas together in one evolving environment.

---

# 🔓 Open Source

IcyWhite is an open-source project.

You can fork it, change it, rename it, extend it, and build your own version according to the project's license.

The purpose of open source is not simply to let people look at the code.

It is to give people a starting point for their own ideas.

---

# 💬 Community and Support

Have a question, found a bug, built something interesting, or want to discuss local AI and browser development?

Join the community:

### 🌐 [Oasis Agentic Browser Community on Oasis Social](https://oasis.myguyinthechair.com/s/oasis-agentic-browser/)

The existing Oasis Social community remains part of the project's history and community presence.

You can use the community to:

- Discuss IcyWhite and related projects
- Share ideas and experiments
- Talk about local AI, models, and automation
- Ask questions and troubleshoot issues
- Share screenshots and projects
- Suggest improvements
- Connect with other users and developers

GitHub is where the code lives. The community is where people can exchange ideas.

For technical issues, include the relevant operating system, runtime, model, configuration, and logs whenever possible. Do not publish API keys, credentials, or private information in bug reports.

---

# ♿ Accessibility

IcyWhite includes interface and keyboard-navigation-related components.

Keyboard behavior may vary between the application shell, web pages, and individual interfaces.

For the current keyboard shortcuts and accessibility options, consult the application's implementation and settings.

---

# 📜 License

IcyWhite is distributed under the **MIT License**, provided that the repository's `LICENSE` file confirms these terms.

You are free to use, modify, fork, and redistribute the project according to the applicable license.

See [`LICENSE`](LICENSE) for the full license text.

---

# 🌐 Project

**IcyWhite 2.0**

An open-source, local-first AI browser and Windows desktop workspace.

**Browse. Build. Create. Experiment. Make it yours.**
