import sublime
import sublime_plugin
import os
import re

# Path to the Elixir grammar that Package Control installs.
# If you keep the default installation, you don’t have to touch this.
ELIXIR_SYNTAX = "Packages/Elixir/Syntaxes/Elixir.tmLanguage"

TMP_ERL_PATTERN = re.compile(r"tmp\..+\.erl$", re.IGNORECASE)

def tmp_erl_to_elixir(view):
    file_path = view.file_name() or ""
    base_name = os.path.basename(file_path)
    if TMP_ERL_PATTERN.match(base_name):
        view.set_syntax_file(ELIXIR_SYNTAX)

class TmpErlToElixir(sublime_plugin.EventListener):
    def on_load_async(self, view):
        tmp_erl_to_elixir(view)

    def on_activated_async(self, view):
        tmp_erl_to_elixir(view)

def plugin_loaded():
    for window in sublime.windows():
        for view in window.views():
            tmp_erl_to_elixir(view)