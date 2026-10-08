-- Consume the key so it never reaches the terminal (Ghostty "ignore").
-- A function binding must return true to consume the key. Otherwise the
-- server passes the key on to the terminal.
local function ignore() return true end

rex.bind("ctrl+left", ignore)
rex.bind("ctrl+right", ignore)
rex.bind("cmd+enter", ignore)

-- Write raw bytes to the focused terminal (Ghostty "text:").
-- Lua 5.1 escapes: \27 is ESC, \127 is DEL.
rex.bind("shift+enter", "com.superlogical.terminal.write", { data = "\27\r" })
rex.bind("alt+backspace", "com.superlogical.terminal.write", { data = "\27\127" })

rex.bind("cmd+r", "client.config.reload")
