package com.rstudio.shinycannon

import org.apache.logging.log4j.Logger
import java.io.File
import java.util.regex.Pattern
import kotlin.system.exitProcess

data class Props(val version: Long, val targetUrl: String, val targetType: ServerType)

data class Recording(val props: Props, val eventLog: ArrayList<Event>)

fun readPropLine(line: String): Pair<String, String> {
    val re = Pattern.compile("""^# (\w+): (.*)$""")
    val matcher = re.matcher(line)
    if (matcher.find()) {
        return Pair(matcher.group(1), matcher.group(2))
    } else {
        throw RuntimeException("Malformed prop line in recording: ${line}")
    }
}

fun readProps(lines: List<String>, logger: Logger): Props {
    val props = lines.asSequence()
            .takeWhile { it.startsWith("#") }
            .map(::readPropLine)
            .toMap()
            .toMutableMap()

    if (props.containsKey("target")) {
        // Recording is in old format; massage into new format
        props["target_url"] = props["target"]!!
        props.remove("target")
        props["version"] = RECORDING_VERSION.toString()
        props["target_type"] = "Unknown"
    }

    listOf("version", "target_url", "target_type").forEach {
        if (!props.containsKey(it)) {
            logger.error("Recording file is missing required property '${it}', you may need to upgrade shinyloadtest and make a new recording")
            exitProcess(1)
        }
    }

    val versionNum = props["version"]!!.toLong()

    return Props(versionNum, props["target_url"]!!, typeFromName(props["target_type"]!!))
}

fun readRecording(recording: File, logger: Logger): Recording {
    val lines = recording.readLines()
    val props = readProps(lines, logger)
    val eventLog = lines
            .mapIndexed { idx, line -> Pair(idx + 1, line) }
            .filterNot { it.second.startsWith("#") }
            .fold(ArrayList<Event>()) { events, (lineNumber, line) ->
                events.also { it.add(Event.fromLine(lineNumber, line)) }
            }
    return Recording(props, eventLog)
}

fun credentialLineExists(recording: Recording): Boolean {
    return recording.eventLog
            .filter { it.name() == "WS_RECV" }
            .any {
                parseMessage((it as Event.WS_RECV).message)
                        ?.getAsJsonObject("custom")
                        ?.has("credentials")
                        ?: false
            }
}
