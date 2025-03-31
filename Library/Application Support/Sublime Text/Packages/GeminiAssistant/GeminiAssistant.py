#      ___/\/\/\/\/\__/\/\__________________________________/\/\________________/\/\________/\/\_________________
#     _/\/\__________/\/\____/\/\/\______/\/\__/\/\________/\/\____/\/\/\____/\/\/\/\/\__/\/\/\/\/\____/\/\/\___
#    _/\/\__________/\/\________/\/\____/\/\__/\/\____/\/\/\/\__/\/\/\/\/\____/\/\________/\/\______/\/\/\/\/\_
#   _/\/\__________/\/\____/\/\/\/\____/\/\__/\/\__/\/\__/\/\__/\/\__________/\/\________/\/\______/\/\_______
#  ___/\/\/\/\/\__/\/\/\__/\/\/\/\/\____/\/\/\/\____/\/\/\/\____/\/\/\/\____/\/\/\______/\/\/\______/\/\/\/\_
# __________________________________________________________________________________________________________
# Renamed and adapted from Claudette for Google Gemini

import sublime
import sublime_plugin
import threading

# Renamed imports
# Ensure these files exist in the specified subdirectories
from .chat.chat_view import GeminiAssistantChatViewListener, GeminiAssistantChatView # Renamed
from .chat.ask_question import GeminiAssistantAskQuestionCommand, GeminiAssistantAskNewQuestionCommand # Renamed
from .chat.chat_history import GeminiAssistantClearChatHistoryCommand, GeminiAssistantExportChatHistoryCommand, GeminiAssistantImportChatHistoryCommand # Renamed

from .context.add_files import GeminiAssistantContextAddFilesCommand # Renamed
from .context.add_current_file import GeminiAssistantContextAddCurrentFileCommand, GeminiAssistantContextRemoveCurrentFileCommand # Renamed
from .context.add_open_files import GeminiAssistantContextAddOpenFilesCommand # Renamed
from .context.clear_files import GeminiAssistantContextClearFilesCommand # Renamed
from .context.manage_files import GeminiAssistantContextManageFilesCommand # Renamed
from .context.refresh_files import GeminiAssistantContextRefreshFilesCommand # Renamed

from .settings.select_model_panel import GeminiAssistantSelectModelPanelCommand # Renamed
from .settings.select_system_message_panel import GeminiAssistantSelectSystemMessagePanelCommand # Renamed

from .statusbar.assistant_spinner import AssistantSpinner # Renamed
from .constants import PLUGIN_NAME, SETTINGS_FILE # Import constants

# Store the spinner globally or manage its lifecycle appropriately
assistant_spinner = AssistantSpinner()

def plugin_loaded():
    # Optionally initialize things when the plugin loads
    print(f"{PLUGIN_NAME} plugin loaded.")
    # Example: Start a brief spinner animation on load
    assistant_spinner.start(f"{PLUGIN_NAME} ready", 1500)

def plugin_unloaded():
    # Clean up resources when the plugin unloads (e.g., stop threads, clear intervals)
    print(f"{PLUGIN_NAME} plugin unloaded.")
    assistant_spinner.stop()
    # Clean up ChatView instances
    # Need a way to access _instances or have a cleanup function
    # GeminiAssistantChatView.cleanup_all_instances() # Add such a method if needed

class GeminiAssistantFocusListener(sublime_plugin.EventListener): # Renamed
    def on_activated(self, view):
        # Renamed settings keys
        if view.settings().get('gemini_assistant_is_chat_view', False):
            self._update_current_chat_status(view)

    def on_load(self, view):
        # Renamed settings keys
        if view.settings().get('gemini_assistant_is_chat_view', False):
            # Ensure status is correct on load as well
            self._update_current_chat_status(view)

    def on_new(self, view):
        # Check if a new view is potentially a chat view being created
        # The settings might not be set yet, handle in view creation logic primarily
        pass

    def on_clone(self, view):
        # Handle cloned chat views if necessary, though cloning scratch views is less common
        if view.settings().get('gemini_assistant_is_chat_view', False):
            # Decide how to handle cloned state (e.g., mark as non-current initially)
            view.settings().set('gemini_assistant_is_current_chat', False)
            self._update_current_chat_status(view) # Re-evaluate which view is current

    def on_pre_close(self, view):
         # Clean up resources associated with the view being closed
         if view.settings().get('gemini_assistant_is_chat_view', False):
              window = view.window()
              if window:
                  manager = GeminiAssistantChatView.get_instance(window)
                  if manager:
                      manager.destroy_view_resources(view)


    def _update_current_chat_status(self, view):
        """Sets the activated chat view as current and unsets others in the same window."""
        window = view.window()
        if not window:
            # This can happen briefly during window closing
            # print(f"No window found for view: {view.id()} during activation")
            return

        current_view_id = view.id()
        # Renamed settings keys
        view.settings().set('gemini_assistant_is_current_chat', True)
        # print(f"View {current_view_id} activated and marked as current chat.")

        # Iterate through other views in the *same* window
        for other_view in window.views():
            if other_view.id() != current_view_id and \
               other_view.settings().get('gemini_assistant_is_chat_view', False) and \
               other_view.settings().get('gemini_assistant_is_current_chat', False):
                # Unset the current flag for other chat views in this window
                other_view.settings().set('gemini_assistant_is_current_chat', False)
                # print(f"View {other_view.id()} unmarked as current chat.")