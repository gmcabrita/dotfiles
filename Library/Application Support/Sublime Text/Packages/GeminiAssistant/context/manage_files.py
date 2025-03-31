import sublime
import sublime_plugin
import os
from ..utils import gemini_assistant_chat_status_message # Renamed import
from ..constants import PLUGIN_NAME
from typing import Optional, List, Dict, Any

class GeminiAssistantContextManageFilesCommand(sublime_plugin.WindowCommand):
    """Shows a quick panel to manage files included in the active chat context."""

    def run(self):
        chat_view = self.find_active_chat_view()
        if not chat_view:
            sublime.status_message("No active Gemini chat view found.")
            return

        # Get context files using renamed setting key
        self.context_files = chat_view.settings().get('gemini_assistant_context_files', {})
        if not isinstance(self.context_files, dict): # Validate
            print(f"{PLUGIN_NAME} Error: Context files setting is not a dictionary.")
            self.context_files = {}

        if not self.context_files:
            sublime.status_message("No files are included in the chat context.")
            # Optionally show the status in the chat view as well
            gemini_assistant_chat_status_message(self.window, "No files currently in context.", "ℹ️")
            return

        # --- Prepare Items for Quick Panel ---
        # Store relative paths (keys) and file info (values) for easy access
        self.relative_paths = sorted(list(self.context_files.keys())) # Sort for consistent order
        panel_items: List[List[str]] = []
        total_tokens = 0
        for rel_path in self.relative_paths:
             file_info = self.context_files[rel_path]
             display_line1 = rel_path
             display_line2 = ""
             if isinstance(file_info, dict):
                  tokens = file_info.get('api_tokens', 0)
                  abs_path_short = os.path.basename(file_info.get('absolute_path', ''))
                  display_line2 = f"~{tokens} tokens | {abs_path_short}"
                  total_tokens += tokens
             # Format for quick panel [[line1, line2], [line1, line2], ...]
             panel_items.append([display_line1, display_line2])


        # Add header/summary item
        summary_item = [f"Total Files: {len(self.relative_paths)}", f"Estimated Tokens: ~{total_tokens}"]
        # panel_items.insert(0, summary_item) # Add summary at the top

        # --- Show Quick Panel ---
        self.window.show_quick_panel(
            items=panel_items,
            on_select=self._on_file_selected,
            # on_highlight=self._on_highlight, # Optional: preview file on highlight?
            flags=sublime.KEEP_OPEN_ON_FOCUS_LOST # Keep panel open if focus lost briefly
        )

    def _on_file_selected(self, index: int):
        """Callback when a file is selected from the first quick panel."""
        if index == -1:
            sublime.status_message("Manage context cancelled.")
            return

        # # Handle summary item selection if it was added
        # if index == 0:
        #      # Re-show the main panel maybe? Or just do nothing.
        #      sublime.set_timeout(self.run, 10) # Re-open panel
        #      return

        # Adjust index if summary item was added: adjusted_index = index - 1
        adjusted_index = index # No adjustment if summary wasn't added

        if not (0 <= adjusted_index < len(self.relative_paths)):
             print(f"{PLUGIN_NAME} Error: Invalid selection index {index}")
             return

        # Get the selected relative path
        self.selected_relative_path = self.relative_paths[adjusted_index]
        file_info = self.context_files.get(self.selected_relative_path)

        if not file_info or not isinstance(file_info, dict):
             sublime.error_message(f"Error retrieving info for '{self.selected_relative_path}'.")
             return

        # --- Show Options for Selected File ---
        options = [
            f"Open File: {os.path.basename(file_info.get('absolute_path', ''))}",
            f"Remove from Context: {self.selected_relative_path}",
            "Cancel"
        ]
        option_details = [
            file_info.get('absolute_path', 'Cannot open'), # Detail for Open
            f"Removes {self.selected_relative_path} from current chat", # Detail for Remove
            "" # Detail for Cancel
        ]

        self.window.show_quick_panel(
            items=[[opt, det] for opt, det in zip(options, option_details)],
            on_select=self._on_option_selected,
            flags=sublime.KEEP_OPEN_ON_FOCUS_LOST
        )

    def _on_option_selected(self, index: int):
        """Callback when an action is selected for the chosen file."""
        if index == -1 or index == 2: # Cancelled or chose "Cancel" explicitly
             # Re-open the first panel to allow managing other files
             sublime.set_timeout(self.run, 10)
             return

        # Retrieve file info again (using stored relative path)
        file_info = self.context_files.get(self.selected_relative_path)
        if not file_info or not isinstance(file_info, dict): return # Should not happen

        chat_view = self.find_active_chat_view() # Ensure chat view still exists
        if not chat_view:
             sublime.status_message("Chat view closed or invalid.")
             return


        if index == 0: # Open File
             abs_path = file_info.get('absolute_path')
             if abs_path and os.path.exists(abs_path):
                 self.window.open_file(abs_path)
             else:
                 sublime.error_message(f"Cannot open file. Path not found or invalid:\n{abs_path}")
             # Re-open the manage panel after opening
             sublime.set_timeout(self.run, 100)


        elif index == 1: # Remove from context
            try:
                # Remove the selected file from the dictionary
                removed_info = self.context_files.pop(self.selected_relative_path)
                # Update the setting in the chat view
                chat_view.settings().set('gemini_assistant_context_files', self.context_files)
                # Provide feedback
                status_message = f"Removed '{self.selected_relative_path}' from chat context"
                gemini_assistant_chat_status_message(self.window, status_message, "✅")
                sublime.status_message(status_message)

                # Re-open the manage panel if there are still files left
                if self.context_files:
                    sublime.set_timeout(self.run, 100)
                else: # No files left, show status
                     sublime.status_message("All files removed from context.")

            except KeyError:
                 sublime.error_message(f"File '{self.selected_relative_path}' was already removed.")
            except Exception as e:
                 print(f"{PLUGIN_NAME} Error removing file from context: {e}")
                 sublime.error_message(f"Failed to remove file: {e}")
                 # Re-open panel even on error
                 sublime.set_timeout(self.run, 100)


    def find_active_chat_view(self) -> Optional[sublime.View]:
        """Helper to find the currently active chat view in the window."""
        # Consistently duplicated, needs refactoring into a shared utility
        for view in self.window.views():
            if (view.settings().get('gemini_assistant_is_chat_view', False) and
                view.settings().get('gemini_assistant_is_current_chat', False)):
                return view
        for view in self.window.views():
             if view.settings().get('gemini_assistant_is_chat_view', False):
                  return view
        return None

    def is_visible(self):
        """Show command if any chat view exists."""
        return bool(self.find_active_chat_view())

    def is_enabled(self):
        """Enable command if the active chat view has included files."""
        chat_view = self.find_active_chat_view()
        if not chat_view:
            return False
        # Check context files using renamed setting key
        included_files = chat_view.settings().get('gemini_assistant_context_files', {})
        return isinstance(included_files, dict) and bool(included_files)