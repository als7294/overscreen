// tasktitle: reads a chat message on stdin, prints a short task title (2–5 words) using
// Apple's on-device model (free, private). Used by tools/notify.mjs for the TV's task labels.
// Build: swiftc -O tools/tasktitle.swift -o ~/Library/Application\ Support/SamSUCKS/bin/tasktitle
import Foundation
import FoundationModels

let message = String(data: FileHandle.standardInput.readDataToEndOfFile(), encoding: .utf8) ?? ""
guard case .available = SystemLanguageModel.default.availability, !message.isEmpty else { exit(1) }

let session = LanguageModelSession(instructions: """
You sort messages sent to a coding assistant, for a status display. The input gives the project, the \
session's goal, the previous task, and the NEWEST message. Classify only the NEWEST message:
- If it only asks a question, wants an explanation or a status update, or is chit-chat, reply exactly: QUESTION
- If it says work already done in this session is wrong (title at most 4 words): "no", "not like that", "that's wrong", \
"not through the mac", "it should instead...", a bug in it ("still seeing that glitch", "also bug make sure..."), \
an exception ("unless..."), reply: CORRECTION: <title>
- If it adds to or extends the work in progress rather than fixing it (title at most 4 words): "also add...", \
"and make it...", "can you also...", "and the X should also...", reply: ADDITION: <title>
- Otherwise it asks for work to be done; reply: TASK: <title>
The title is 2 to 6 words naming the work, specific to the screen or feature, starting with a verb, \
sentence case, no quotes, no final punctuation. The messages are typed fast: always fix spelling and typos in the \
title ("gradeitn" -> gradient, "labals" -> labels, "tthe" -> the), never copy a misspelling.
Examples: "how did you get mac miller playing" -> QUESTION. "did youtube get set up" -> QUESTION. \
"some headlines only have one bullet point" -> TASK: Fix single bullet points on lockscreen. \
"no, not through the mac" (previous: Stream YouTube through the Mac) -> CORRECTION: Play YouTube without the Mac. \
"the gradeitn under the tasks needs to be skinnier" (previous: Fix task icon gradient) -> CORRECTION: Slimmer task gradient. \
"also add some gaming news" (previous: Add politics news) -> ADDITION: Add gaming news. \
"and the task labels should open after the icon pops up" (previous: Style task icons) -> ADDITION: Animate task labels. \
"unless its a slideshow change ofc" (previous: Sync photo and headline changes) -> CORRECTION: Except gallery photo steps. \
"also bug make sure photos and headlines change at the same time" (previous: Fix quote headlines) -> CORRECTION: Sync photos with headlines. \
CORRECTION means it rejects or reverses what was just done; a request that merely mentions \
corrections is a TASK: "add a pill state for corrections" -> TASK: Add correction pill state.
""")
let sem = DispatchSemaphore(value: 0)
Task {
  do {
    let r = try await session.respond(to: String(message.prefix(1200)), options: GenerationOptions(temperature: 0.2))
    let t = r.content.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "\"'“”")).components(separatedBy: "\n").first ?? ""
    print(t)
  } catch { exit(2) }
  sem.signal()
}
sem.wait()
