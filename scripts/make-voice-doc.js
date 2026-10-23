// Writes VOICE-COMMANDS.md from the same list the app shows in Settings > Voice > "Voice commands" (js/voice-app-commands.js).
const fs = require("fs"), path = require("path");
const { CATALOG } = require("../js/voice-app-commands.js");
let o = "# IcyWhite voice commands (hands-free live chat)\n\n";
o += "Start live chat (the waveform button), then talk. If it says *Waiting for “computer”…*, begin with the wake word (change it in Settings > Voice, or say *change the wake word to jarvis*): **“Computer, dark mode.”** After the first command you can keep talking without it until you are quiet for a while.\n\n";
o += "Say each command as one short sentence. Politeness is fine (*please*, *can you*, *for me*, *thanks*). The lines under **Say** are different natural ways to ask for the same thing. A normal sentence that only *contains* these words (“turn on the light in the kitchen”) is never taken as a command; it goes to the AI.\n\n";
o += "You can also see this list inside the app: **say “what can I say”**, or Settings > Voice > *Voice commands…*. Say **“help with settings”** (or chats, tabs, volume, models, switches, camera, approvals) to hear one group read aloud.\n\n";
CATALOG.forEach((g) => {
  o += "## " + g.group + "\n\n| Say (any of these) | What it does |\n|---|---|\n";
  g.items.forEach((it) => { o += "| " + it.say.map((s) => "“" + s + "”").join("<br>") + " | " + it.does + " |\n"; });
  o += "\n";
});
o += "## Good to know\n\n";
o += "- **Anything that runs code or deletes asks first.** *Run the command*, *delete that reply*, *delete this chat* and *close all other tabs* read back what they will do and wait for *yes* or *no*.\n";
o += "- **Operating-system windows can't be spoken to.** *Attach a file*, *open a project folder* and *share my screen* open the normal Windows picker; choosing there needs the keyboard or mouse. Windows tools that ask Yes/Cancel (Registry Editor etc.) use a system dialog as well.\n";
o += "- Switches that live in Settings (web search, memory, compact mode, commands...) are changed and **saved automatically** when you say them while Settings is closed. If Settings is already open, say *save settings*.\n";
o += "- If a command isn't understood it is simply sent to the AI as a normal message, so nothing is lost.\n";
o += "- Works with the built-in offline speech engine (Whisper) and the browser's own recognizer. Short, clear sentences are recognized best.\n";
fs.writeFileSync(path.join(__dirname, "..", "VOICE-COMMANDS.md"), o);
console.log("wrote VOICE-COMMANDS.md (" + CATALOG.reduce((n, g) => n + g.items.length, 0) + " command rows)");
