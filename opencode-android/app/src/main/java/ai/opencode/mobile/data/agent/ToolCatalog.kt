package ai.opencode.mobile.data.agent

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.jsonArray

/**
 * OpenAI-style function/tool definitions the agent exposes to the model. Kept as raw JSON
 * for clarity and full control over the schema sent on the wire. These let a tool-capable
 * model actually operate on the on-device workspace and the web — the mobile analogue of a
 * desktop coding agent's file/search tools.
 */
object ToolCatalog {

    private const val RAW = """
[
  {
    "type": "function",
    "function": {
      "name": "list_files",
      "description": "List files and folders in the on-device workspace. Use this to explore the project before reading or editing.",
      "parameters": {
        "type": "object",
        "properties": {
          "path": { "type": "string", "description": "Directory path relative to the workspace root. Empty or '.' means the root." }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "read_file",
      "description": "Read the full text contents of a file in the workspace.",
      "parameters": {
        "type": "object",
        "properties": {
          "path": { "type": "string", "description": "File path relative to the workspace root." }
        },
        "required": ["path"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "write_file",
      "description": "Create or overwrite a file in the workspace with the given content. Parent folders are created if needed.",
      "parameters": {
        "type": "object",
        "properties": {
          "path": { "type": "string", "description": "File path relative to the workspace root." },
          "content": { "type": "string", "description": "The complete new contents of the file." }
        },
        "required": ["path", "content"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "web_fetch",
      "description": "Fetch the text content of a public URL (docs, references, APIs). Returns a truncated plain-text body.",
      "parameters": {
        "type": "object",
        "properties": {
          "url": { "type": "string", "description": "An absolute http(s) URL to fetch." }
        },
        "required": ["url"]
      }
    }
  }
]
"""

    fun toolsArray(json: Json): JsonArray = json.parseToJsonElement(RAW).jsonArray
}
