-- Consume the key so it never reaches the terminal (Ghostty "ignore").
-- A function binding must return true to consume the key. Otherwise the
-- server passes the key on to the terminal.
local function ignore() return true end

rex.bind("alt+left", "com.superlogical.terminal.write", { data = "\27b" })
rex.bind("alt+right", "com.superlogical.terminal.write", { data = "\27f" })
rex.bind("ctrl+left", "com.superlogical.terminal.write", { data = "\27b" })
rex.bind("ctrl+right", "com.superlogical.terminal.write", { data = "\27f" })
rex.bind("cmd+left", "com.superlogical.terminal.write", { data = "\1" })
rex.bind("cmd+right", "com.superlogical.terminal.write", { data = "\5" })
rex.bind("cmd+enter", ignore)

-- Write raw bytes to the focused terminal (Ghostty "text:").
-- Lua 5.1 escapes: \27 is ESC, \127 is DEL.
rex.bind("shift+enter", "com.superlogical.terminal.write", { data = "\27\r" })
rex.bind("alt+backspace", "com.superlogical.terminal.write", { data = "\27\127" })

rex.bind("cmd+r", "client.config.reload")

-- Backend for ~/.local/bin/rex-fzf: shows stdin lines in the command palette.
rex.action{
  name = "fzf_pick",
  title = "fzf Pick",
  args = {
    type = "object",
    properties = {
      items = { type = "array", items = { type = "string" } },
      title = { type = "string" },
      query = { type = "string" },
      multi = { type = "boolean" },
    },
    required = { "items" },
    additionalProperties = false,
  },
  run = function(ctx, args)
    local result, why, detail = rex.ui.pick{
      title = args.title or "fzf",
      placeholder = "Filter",
      value = args.query,
      items = args.items,
      multiple = args.multi or false,
      timeout = 3600,
    }
    if result == nil then
      return { status = why, detail = detail }
    end
    if type(result) == "string" then
      result = { result }
    end
    return { status = "ok", selected = result }
  end,
}
