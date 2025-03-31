import sublime
import sublime_plugin
from ..constants import PLUGIN_NAME

class GeminiAssistantContextAddOpenFilesCommand(sublime_plugin.WindowCommand):
    """Adds all currently open *saved* files to the active chat context."""
    def run(self):
        open_file_paths = []
        active_window = self.window or sublime.active_window() # Ensure we have a window

        if not active_window:
             sublime.status_message("Cannot add open files, no active window found.")
             return

        # Iterate through views in the active window
        for view in active_window.views():
            file_name = view.file_name()
            # Add only if the view has a filename (is saved) and is not the chat view itself
            if file_name and not view.settings().get('gemini_assistant_is_chat_view', False):
                open_file_paths.append(file_name)

        if not open_file_paths:
            sublime.status_message("No saved files currently open to add to context.")
            return

        # Call the 'add_files' command with the collected paths
        # This centralizes the logic of finding the chat view and adding files
        active_window.run_command('gemini_assistant_context_add_files', {'paths': open_file_paths})
        # Status message handled by the called command

    def is_enabled(self):
        """Enable only if there's at least one open, saved, non-chat file AND a chat view exists."""
        active_window = self.window or sublime.active_window()
        if not active_window: return False

        has_open_file = False
        has_chat_view = False

        for view in active_window.views():
             if view.settings().get('gemini_assistant_is_chat_view', False):
                  has_chat_view = True
             elif view.file_name(): # File is saved and not a chat view
                  has_open_file = True

             # If both conditions met, we can enable early
             if has_open_file and has_chat_view:
                  return True

        return False # Conditions not met

    def is_visible(self):
         """Always visible in command palette/menus."""
         return True