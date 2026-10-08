-- Bind to a no-op function so the key does nothing (Ghostty "ignore").
local function ignore() end

rex.bind("ctrl+left", ignore)
rex.bind("ctrl+right", ignore)
rex.bind("cmd+enter", ignore)

-- Write raw bytes to the focused terminal (Ghostty "text:").
-- Lua 5.1 escapes: \27 is ESC, \127 is DEL.
rex.bind("shift+enter", "com.superlogical.terminal.write", { data = "\27\r" })
rex.bind("alt+backspace", "com.superlogical.terminal.write", { data = "\27\127" })

rex.bind("cmd+r", "client.config.reload")
