import sublime
import sublime_plugin
from ..utils import gemini_assistant_chat_status_message # Renamed import
from ..constants import PLUGIN_NAME
from typing import Optional

class GeminiAssistantContextClearFilesCommand(sublime_plugin.WindowCommand):
    """Removes all included files from the active chat view's context."""
    def run(self):
        chat_view = self.find_active_chat_view()
        if not chat_view:
            sublime.status_message("No active Gemini chat view found.")
            return

        # Get current context using renamed setting key
        included_files = chat_view.settings().get('gemini_assistant_context_files', {})
        if not isinstance(included_files, dict): # Validate type
             print(f"{PLUGIN_NAME} Warning: Context files setting is not a dictionary. Resetting.")
             included_files = {}

        file_count = len(included_files)

        if file_count == 0:
             sublime.status_message("No files currently included in the chat context.")
             return

        # --- Confirmation Dialog ---
        if sublime.ok_cancel_dialog(
            f"⚠️ Clear Included Files?\n\n"
            f"Remove {file_count} file{'s' if file_count != 1 else ''} from the chat context for this tab?\n\n"
            f"The AI will no longer see the content of these files unless added again.",
            "Clear Included Files" # OK button text
        ):
             # --- Clear the Setting ---
            try:
                chat_view.settings().set('gemini_assistant_context_files', {}) # Set to empty dict
                # Provide feedback
                status_message = f"Cleared {file_count} included file{'s' if file_count != 1 else ''} from chat context."
                gemini_assistant_chat_status_message(self.window, status_message, "✅")
                sublime.status_message(status_message)
            except Exception as e:
                 print(f"{PLUGIN_NAME} Error clearing context files setting: {e}")
                 sublime.error_message(f"Failed to clear included files: {e}")
        else:
             # User cancelled
             sublime.status_message("Clear included files cancelled.")


    def find_active_chat_view(self) -> Optional[sublime.View]:
        """Helper to find the currently active chat view in the window."""
        # Duplicated yet again, strong candidate for shared util
        for view in self.window.views():
            # Use renamed settings keys
            if (view.settings().get('gemini_assistant_is_chat_view', False) and
                view.settings().get('gemini_assistant_is_current_chat', False)):
                return view
        # Fallback: Return the first chat view found if none is marked as current
        for view in self.window.views():
             if view.settings().get('gemini_assistant_is_chat_view', False):
                  return view
        return None

    def is_visible(self):
        """Controls whether the command appears at all."""
        # Show if *any* chat view exists in the window
        return bool(self.find_active_chat_view())

    def is_enabled(self):
        """Enable only if the active chat view *has* included files."""
        chat_view = self.find_active_chat_view()
        if not chat_view:
            return False

        # Get context files using renamed setting key
        included_files = chat_view.settings().get('gemini_assistant_context_files', {})
        # Enable only if the dictionary is not empty
        return isinstance(included_files, dict) and bool(included_files)