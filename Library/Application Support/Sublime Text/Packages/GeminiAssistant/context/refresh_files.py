import sublime
import sublime_plugin
import os
from .file_handler import GeminiAssistantFileHandler # Renamed import
from ..constants import PLUGIN_NAME
from ..utils import gemini_assistant_chat_status_message # Renamed import
from typing import Optional, Dict, Any

class GeminiAssistantContextRefreshFilesCommand(sublime_plugin.WindowCommand):
    """Reloads the content of files included in context for all active chat views."""

    def run(self):
        total_views_processed = 0
        total_files_updated = 0
        total_files_removed = 0
        total_files_failed = 0

        # Iterate through all windows and their views
        for window in sublime.windows():
            for view in window.views():
                # Check if it's a Gemini chat view using renamed setting key
                if view.settings().get('gemini_assistant_is_chat_view', False):
                    total_views_processed += 1
                    # Process context for this specific chat view
                    result = self.refresh_context_for_view(view)
                    total_files_updated += result['updated']
                    total_files_removed += result['removed']
                    total_files_failed += result['failed']

        # --- Provide Summary Feedback ---
        if total_views_processed == 0:
            sublime.status_message("No active Gemini chat views found to refresh.")
            return

        message_parts = []
        if total_files_updated > 0:
            message_parts.append(f"updated {total_files_updated} file{'s' if total_files_updated != 1 else ''}")
        if total_files_removed > 0:
            message_parts.append(f"removed {total_files_removed} missing file{'s' if total_files_removed != 1 else ''}")
        if total_files_failed > 0:
             message_parts.append(f"failed to update {total_files_failed} file{'s' if total_files_failed != 1 else ''}")


        if message_parts:
            final_message = f"Context refresh: {', '.join(message_parts)} across {total_views_processed} view{'s' if total_views_processed != 1 else ''}."
            # Show message in the *last processed* chat view's window status bar, or active window
            target_window = self.window or sublime.active_window()
            if target_window:
                 # Use renamed status util - maybe adapt it to show globally?
                 # For now, just show in status bar.
                 # gemini_assistant_chat_status_message(target_window, final_message, "🔄")
                 sublime.status_message(final_message)
        else:
            sublime.status_message("Context refresh: No files needed updating or removal.")


    def refresh_context_for_view(self, chat_view: sublime.View) -> Dict[str, int]:
        """Refreshes the context files for a single chat view."""
        view_updated = 0
        view_removed = 0
        view_failed = 0

        # Get current context using renamed setting key
        current_context = chat_view.settings().get('gemini_assistant_context_files', {})
        if not isinstance(current_context, dict):
             print(f"{PLUGIN_NAME} Error: Invalid context format in view {chat_view.id()}. Cannot refresh.")
             return {'updated': 0, 'removed': 0, 'failed': 1} # Count as failed

        if not current_context:
             # print(f"{PLUGIN_NAME} Debug: No context files to refresh in view {chat_view.id()}")
             return {'updated': 0, 'removed': 0, 'failed': 0} # Nothing to do

        # Use a new handler instance to build the refreshed context
        file_handler = GeminiAssistantFileHandler()
        # We don't load existing context here, we rebuild it based on absolute paths

        # Determine a consistent context root (needed for process_single_file)
        # Extract absolute paths and find common root
        abs_paths = [info.get('absolute_path') for info in current_context.values() if isinstance(info, dict) and info.get('absolute_path')]
        context_root = os.getcwd() # Default
        if abs_paths:
             try:
                  common_root = os.path.commonpath(abs_paths)
                  if not os.path.isdir(common_root): common_root = os.path.dirname(common_root)
                  context_root = common_root
             except ValueError: pass # Different drives, keep CWD
             except Exception as e: print(f"{PLUGIN_NAME} Error finding common path for refresh: {e}")


        # Iterate through the *existing* context items (relative paths and info)
        for relative_path, file_info in current_context.items():
             if not isinstance(file_info, dict): continue # Skip invalid entries

             absolute_path = file_info.get('absolute_path')
             if not absolute_path:
                  print(f"{PLUGIN_NAME} Warning: Missing absolute path for '{relative_path}' in view {chat_view.id()}. Removing.")
                  view_removed += 1 # Count as removed if invalid
                  continue

             # Check if the file still exists
             if not os.path.exists(absolute_path) or not os.path.isfile(absolute_path):
                  print(f"{PLUGIN_NAME} Info: File no longer exists, removing from context: {absolute_path}")
                  view_removed += 1
                  continue # Skip to next file, it won't be added to the new context

             # File exists, try to re-process it using the handler
             # This re-reads content, checks text status, estimates tokens
             processed_rel_path = file_handler.process_single_file(absolute_path, context_root)

             if processed_rel_path:
                  # Successfully processed (updated content, etc.)
                  view_updated += 1
             else:
                  # Failed to process (e.g., became binary, read error)
                  print(f"{PLUGIN_NAME} Warning: Failed to re-process file for context: {absolute_path}")
                  view_failed += 1
                  # Keep the old entry? Or remove on failure? Let's remove on failure.
                  view_removed += 1 # Count as removed if refresh fails


        # --- Update the View's Settings ---
        # Only update if changes occurred
        if view_updated > 0 or view_removed > 0 or view_failed > 0:
             try:
                  # Replace the old context with the newly built one from file_handler
                  chat_view.settings().set('gemini_assistant_context_files', file_handler.files)
             except Exception as e:
                  print(f"{PLUGIN_NAME} Error updating settings for view {chat_view.id()} during refresh: {e}")
                  # Increment failure count if settings update fails?
                  view_failed += 1


        return {'updated': view_updated, 'removed': view_removed, 'failed': view_failed}


    def is_enabled(self):
        """Enable command if any chat view has context files."""
        for window in sublime.windows():
            for view in window.views():
                # Use renamed setting key
                if (view.settings().get('gemini_assistant_is_chat_view', False) and
                    view.settings().has('gemini_assistant_context_files') and # Check if key exists
                    bool(view.settings().get('gemini_assistant_context_files', {}))): # Check if not empty
                    return True # Enable if at least one view has non-empty context
        return False # Disable if no view has context

    def is_visible(self):
        """Always visible in command palette/menus."""
        return True