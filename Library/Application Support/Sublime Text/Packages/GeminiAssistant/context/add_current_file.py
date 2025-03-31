import sublime
import sublime_plugin
# Renamed util function import
from ..utils import gemini_assistant_chat_status_message
from ..constants import PLUGIN_NAME # Optional: for logging/errors
from typing import Union

# Renamed command
class GeminiAssistantContextAddCurrentFileCommand(sublime_plugin.WindowCommand):
    """Adds the currently active file (if saved) to the active chat view's context."""
    def run(self):
        view = self.window.active_view()
        if not view:
            sublime.status_message("No active view found.")
            return

        file_path = view.file_name()
        if not file_path:
            sublime.status_message("Cannot add unsaved file to context.")
            return

        # Run the renamed add_files command, passing the single file path
        # The add_files command handles finding the chat view and adding the file.
        self.window.run_command('gemini_assistant_context_add_files', {'paths': [file_path]})
        # Status message is handled by gemini_assistant_context_add_files

    def is_visible(self):
        """Controls whether the command appears in menus/palette."""
        view = self.window.active_view()
        if not view:
            return False

        # Don't show command if the active view is the chat view itself
        # Use renamed setting key
        if view.settings().get('gemini_assistant_is_chat_view', False):
            return False

        # Only show for saved files (must have a file_name)
        if not view.file_name():
            return False

        # Only show if a chat view actually exists in the window
        return bool(self.find_active_chat_view())


    def is_enabled(self):
        """Controls whether the command is greyed out."""
        # Essentially the same conditions as visibility for this command
        view = self.window.active_view()
        if not view: return False
        if view.settings().get('gemini_assistant_is_chat_view', False): return False
        if not view.file_name(): return False
        if not self.find_active_chat_view(): return False

        # Additionally, disable if the file is *already* in context? (Optional)
        # chat_view = self.find_active_chat_view()
        # if chat_view:
        #      context_files = chat_view.settings().get('gemini_assistant_context_files', {})
        #      current_file_path = view.file_name()
        #      for file_info in context_files.values():
        #           if file_info.get('absolute_path') == current_file_path:
        #                return False # Already included, disable "Add"

        return True # If all checks pass, enable

    def find_active_chat_view(self) -> Union[sublime.View, None]:
        """Helper to find the currently active chat view in the window."""
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


# Renamed command
class GeminiAssistantContextRemoveCurrentFileCommand(sublime_plugin.WindowCommand):
    """Removes the currently active file from the active chat view's context."""
    def run(self):
        view = self.window.active_view()
        if not view:
            sublime.status_message("No active view found.")
            return

        file_path = view.file_name()
        if not file_path:
            # Should not happen if is_enabled works correctly, but check anyway
            sublime.status_message("Cannot remove unsaved file from context.")
            return

        # Get the current chat view
        chat_view = self.find_active_chat_view()
        if not chat_view:
            sublime.status_message("No active Gemini chat view found.")
            return

        # Get current context files using renamed setting key
        context_files = chat_view.settings().get('gemini_assistant_context_files', {})
        if not isinstance(context_files, dict): # Ensure it's a dictionary
             print(f"{PLUGIN_NAME} Error: Context files setting is not a dictionary.")
             context_files = {} # Reset if corrupted

        if not context_files:
            sublime.status_message("No files currently in chat context.")
            return

        # --- Find and Remove the File ---
        # We need the relative path key to remove it from the dictionary
        relative_path_to_remove = None
        for rel_path, file_info in context_files.items():
            # Check if 'absolute_path' exists and matches
            if isinstance(file_info, dict) and file_info.get('absolute_path') == file_path:
                relative_path_to_remove = rel_path
                break # Found the file

        if relative_path_to_remove:
            # Remove the file from the dictionary
            removed_file_info = context_files.pop(relative_path_to_remove)
            # Update the setting in the chat view
            chat_view.settings().set('gemini_assistant_context_files', context_files)
            # Provide user feedback
            # Use renamed status util, targeting the correct window
            status_message = f"Removed '{relative_path_to_remove}' from chat context"
            gemini_assistant_chat_status_message(self.window, status_message, "✅")
            sublime.status_message(status_message) # Also show in status bar
        else:
            # File wasn't found in the context
            sublime.status_message("Current file not found in chat context.")

    def find_active_chat_view(self) -> Union[sublime.View, None]:
        """Helper to find the currently active chat view in the window."""
        # Duplicated from Add command, consider moving to a shared context util module
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
        """Controls whether the command appears in menus/palette."""
        view = self.window.active_view()
        if not view: return False
        # Don't show command if the active view is the chat view itself
        # Use renamed setting key
        if view.settings().get('gemini_assistant_is_chat_view', False): return False
        # Only show for saved files
        if not view.file_name(): return False
        # Only show if a chat view exists
        return bool(self.find_active_chat_view())

    def is_enabled(self):
        """Enable only if the current file *is* actually in the context."""
        if not self.is_visible(): return False # Inherit visibility constraints

        view = self.window.active_view()
        # These checks should be redundant due to is_visible, but double-check
        if not view or not view.file_name(): return False

        chat_view = self.find_active_chat_view()
        if not chat_view: return False

        # Get context files using renamed setting key
        context_files = chat_view.settings().get('gemini_assistant_context_files', {})
        if not isinstance(context_files, dict): return False # Invalid context

        current_file_path = view.file_name()

        # Check if the absolute path exists in the context values
        for file_info in context_files.values():
            if isinstance(file_info, dict) and file_info.get('absolute_path') == current_file_path:
                return True # Enable the command because file is found

        return False # File not in context, disable "Remove" command