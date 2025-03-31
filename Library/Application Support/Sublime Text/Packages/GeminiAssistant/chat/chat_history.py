import sublime
import sublime_plugin
import json
import os
from typing import List, Dict, Any, Optional
from ..constants import PLUGIN_NAME # Ensure PLUGIN_NAME is updated if needed
from ..utils import gemini_assistant_chat_status_message # Renamed util function
# Renamed import
from .ask_question import GeminiAssistantAskQuestionCommand
# Renamed import
from .chat_view import GeminiAssistantChatView

# --- Cache Path Management ---

# Renamed function
def gemini_assistant_get_cache_path() -> str:
    """Gets the full path to the cache file storing the last directory."""
    cache_dir = os.path.join(sublime.cache_path(), PLUGIN_NAME) # Use updated PLUGIN_NAME
    # Ensure cache directory exists
    if not os.path.exists(cache_dir):
        try:
            os.makedirs(cache_dir, exist_ok=True) # exist_ok=True prevents error if dir exists
        except OSError as e:
             print(f"{PLUGIN_NAME} Error creating cache directory '{cache_dir}': {e}")
             # Fallback to user's home directory? Or just fail?
             # For simplicity, we'll let it potentially fail to write later.
    return os.path.join(cache_dir, 'last_chat_history_path.txt')

# Renamed function (or keep original if generic)
def get_last_directory() -> Optional[str]:
    """Gets the last used directory path from the cache file."""
    cache_path = gemini_assistant_get_cache_path() # Use renamed function
    try:
        if os.path.exists(cache_path) and os.path.isfile(cache_path):
            with open(cache_path, 'r', encoding='utf-8') as f:
                last_dir = f.read().strip()
                # Validate that the cached path is an existing directory
                if last_dir and os.path.exists(last_dir) and os.path.isdir(last_dir):
                    return last_dir
                else:
                     print(f"{PLUGIN_NAME} Warning: Cached directory '{last_dir}' not found or invalid.")
    except IOError as e:
        print(f"{PLUGIN_NAME} Error reading cache file '{cache_path}': {e}")
    except Exception as e:
        print(f"{PLUGIN_NAME} Unexpected error reading cache: {str(e)}")

    # Fallback if cache is invalid or doesn't exist
    return None

# Renamed function
def gemini_assistant_save_last_directory(file_path: str):
    """Saves the *directory* of the given file path to the cache."""
    if not file_path: return
    cache_path = gemini_assistant_get_cache_path() # Use renamed function
    try:
        # Extract the directory containing the file
        dir_name = os.path.dirname(file_path)
        if dir_name and os.path.isdir(dir_name): # Ensure the directory exists
            with open(cache_path, 'w', encoding='utf-8') as f:
                f.write(dir_name)
        else:
             print(f"{PLUGIN_NAME} Warning: Cannot save directory for path '{file_path}', directory invalid.")
    except IOError as e:
        print(f"{PLUGIN_NAME} Error writing to cache file '{cache_path}': {e}")
    except Exception as e:
        print(f"{PLUGIN_NAME} Unexpected error saving to cache: {str(e)}")

# Renamed function
def gemini_assistant_get_current_directory(window: sublime.Window) -> str:
    """
    Determines the best directory for file dialogs.
    Prioritizes: Active view's directory, Last used directory, User's home.
    """
    active_view_dir = None
    view = window.active_view()
    if view and view.file_name():
        current_file_dir = os.path.dirname(view.file_name())
        if os.path.exists(current_file_dir) and os.path.isdir(current_file_dir):
            active_view_dir = current_file_dir

    last_dir = get_last_directory()

    # Use active view's dir if valid, else last used dir if valid, else home
    if active_view_dir:
        return active_view_dir
    elif last_dir:
        return last_dir
    else:
        # Absolute fallback: user's home directory
        home_dir = os.path.expanduser("~")
        if os.path.exists(home_dir) and os.path.isdir(home_dir):
            return home_dir
        else:
             # Final fallback: current working directory (less ideal)
             return os.getcwd()

# --- Message Validation ---

# Renamed function
def gemini_assistant_validate_and_sanitize_message(message: Any) -> bool:
    """
    Validates a single message object for import/export (user/assistant roles).
    Mutates the dictionary in place to keep only valid keys if valid.
    Returns True if valid, False otherwise.
    """
    if not isinstance(message, dict):
        return False

    # Expect 'role' and 'content' keys
    if 'role' not in message or 'content' not in message:
        return False

    # Allow only 'user' and 'assistant' roles (internal format)
    if message['role'] not in {'user', 'assistant'}:
        return False

    # Content must be a string
    if not isinstance(message['content'], str):
        # Maybe attempt conversion or reject? For now, reject.
        return False

    # Keep only the essential keys
    cleaned_message = {
        'role': message['role'],
        'content': message['content']
        # Add other keys here if needed in the future (e.g., timestamp)
    }

    # Overwrite the original dict with the cleaned one
    # This ensures the list processed later contains only sanitized dicts
    message.clear()
    message.update(cleaned_message)

    return True

# --- Commands ---

# Renamed command
class GeminiAssistantImportChatHistoryCommand(sublime_plugin.WindowCommand):
    """Imports a chat history JSON file into a new chat view."""

    def run(self):
        """Initiates the file selection dialog."""
        try:
            # Define desired file extension (though dialog doesn't enforce it)
            # file_types = [("JSON Chat History", ["json"])] # Not used by dialog
            directory = gemini_assistant_get_current_directory(self.window) # Use renamed util

            # Use Sublime's modern open dialog API
            sublime.active_window().show_open_dialog(
                title="Import Gemini Chat History", # Dialog title
                directory=directory,
                on_select=self._on_select, # Callback for single file selection
                on_cancel=lambda: sublime.status_message("Import cancelled."),
                # multi_select=False, # Default is single select
                # allow_folders=False # Default is files only
            )
        except Exception as e:
            print(f"{PLUGIN_NAME} Error initiating import dialog: {str(e)}")
            sublime.error_message(f"{PLUGIN_NAME}: Could not start chat history import: {e}")

    def _on_select(self, path: Optional[str]):
        """Callback executed when a file is selected in the dialog."""
        if not path: # Should not happen with on_select, but check anyway
            sublime.status_message("Import cancelled or no path received.")
            return

        if not path.lower().endswith('.json'):
            sublime.error_message("Invalid file type. Please select a '.json' file.")
            return

        try:
            gemini_assistant_save_last_directory(path) # Use renamed util to save the directory

            # --- Read and Validate File Content ---
            with open(path, 'r', encoding='utf-8') as f:
                import_data = json.load(f)

            # Basic format validation
            if not isinstance(import_data, dict) or 'messages' not in import_data:
                raise ValueError("Invalid chat history format: Missing 'messages' key at top level.")

            raw_messages = import_data['messages']
            if not isinstance(raw_messages, list):
                raise ValueError("Invalid chat history format: 'messages' value must be a list.")

            # Validate and sanitize each message *before* creating the view
            valid_messages = [msg for msg in raw_messages if gemini_assistant_validate_and_sanitize_message(msg)]

            if not valid_messages:
                raise ValueError("No valid 'user' or 'assistant' messages found in the import file.")

            # --- Create a New Chat View ---
            # Get the active view to pass to the AskQuestion command constructor,
            # which helps find the right window context.
            active_view = self.window.active_view() or self.window.new_file() # Ensure a view exists

            ask_cmd_instance = GeminiAssistantAskQuestionCommand(active_view) # Use renamed command
            ask_cmd_instance.load_settings()

            # Force creation of a new panel and get the manager instance
            if not ask_cmd_instance.get_chat_view_manager(force_new=True):
                 # Error message shown by get_chat_view_manager
                 return
            chat_view_manager = ask_cmd_instance.chat_view_manager
            sublime_view = chat_view_manager.create_or_get_view() # Actually create the view now

            if not sublime_view or not chat_view_manager:
                sublime.error_message(f"{PLUGIN_NAME}: Failed to create chat view for import.")
                return

            # --- Populate the New View ---
            sublime_view.set_read_only(False)
            # Clear potential placeholder content if any
            sublime_view.run_command('select_all')
            sublime_view.run_command('right_delete')

            # Apply chat view settings (e.g., line numbers, rulers)
            chat_settings = ask_cmd_instance.settings.get('chat', {})
            show_line_numbers = chat_settings.get('line_numbers', False)
            rulers = chat_settings.get('rulers', []) # Rulers should be a list
            sublime_view.settings().set("line_numbers", show_line_numbers)
            sublime_view.settings().set("rulers", rulers)
            sublime_view.settings().set("gutter", show_line_numbers)

            first_message_output = True
            for message in valid_messages:
                role = message['role']
                content = message['content']

                # Format based on role for display in Markdown
                if role == 'user':
                    display_prefix = "" if first_message_output else "\n\n"
                    # Use the manager's append_text method for consistency
                    chat_view_manager.append_text(
                        f"{display_prefix}## Question\n\n{content}\n\n### Gemini's Response\n\n", # Renamed model
                        scroll_to_end=False
                    )
                    first_message_output = False
                elif role == 'assistant':
                    # Append assistant response content directly
                    chat_view_manager.append_text(
                        f"{content}\n",
                        scroll_to_end=False
                    )

            # --- Store the Loaded History in the New View's Settings ---
            # Use the renamed setting key. Store the *validated* messages.
            sublime_view.settings().set('gemini_assistant_conversation_json', json.dumps(valid_messages))

            # --- Finalize View State ---
            sublime_view.set_read_only(True)
            # Scroll to end and place cursor there for immediate follow-up
            end_point = sublime_view.size()
            sublime_view.sel().clear()
            sublime_view.sel().add(sublime.Region(end_point))
            sublime_view.show_at_center(end_point) # Try to center the end point

            # Update buttons for code blocks etc. after loading all content
            chat_view_manager.on_streaming_complete()

            sublime.status_message(f"{PLUGIN_NAME}: Chat history imported successfully into new view.")
            self.window.focus_view(sublime_view) # Focus the new view

        # --- Error Handling ---
        except FileNotFoundError:
            sublime.error_message(f"Error: Import file not found at '{path}'.")
        except json.JSONDecodeError:
            sublime.error_message(f"Error: Could not decode JSON from the import file. Please ensure it's valid JSON.")
        except ValueError as ve: # Catch our specific validation errors
            print(f"{PLUGIN_NAME} Validation Error loading chat history: {str(ve)}")
            sublime.error_message(f"Could not load chat history - Invalid Format: {str(ve)}")
        except IOError as e:
             sublime.error_message(f"Error reading file: Could not read from '{path}'. Check permissions. ({e.strerror})")
        except Exception as e:
            print(f"{PLUGIN_NAME} Unexpected error loading chat history: {type(e).__name__}: {str(e)}")
            # import traceback; traceback.print_exc() # For debugging
            sublime.error_message(f"An unexpected error occurred during import: {str(e)}")


# Renamed command
class GeminiAssistantExportChatHistoryCommand(sublime_plugin.WindowCommand):
    """Exports the chat history from the currently active chat view to a JSON file."""

    def run(self):
        """Initiates the export process."""
        try:
            # Find the *current* active chat view
            view = self.find_current_chat_view()
            if not view:
                sublime.status_message("No active Gemini chat view found to export.")
                return

            # Retrieve conversation from the view's settings
            # Use renamed setting key
            self.conversation_json_str = view.settings().get('gemini_assistant_conversation_json', '[]')
            try:
                # Store parsed messages as instance variable for the callback
                self.messages_to_export = json.loads(self.conversation_json_str)
            except json.JSONDecodeError:
                sublime.error_message("Error: Chat history data in the current view is corrupted and cannot be exported.")
                self.messages_to_export = [] # Ensure it's reset
                return

            # Check if there's anything to export
            if not isinstance(self.messages_to_export, list) or not self.messages_to_export:
                sublime.status_message("No chat history found in the active view to export.")
                return

            # --- Prepare for Save Dialog ---
            directory = gemini_assistant_get_current_directory(self.window) # Use renamed util
            default_filename = "gemini_chat_history.json" # Renamed default filename

            # Use Sublime's modern save dialog API
            sublime.active_window().show_save_dialog(
                 title="Export Gemini Chat History As", # Dialog title
                 directory=directory,
                 name=default_filename, # Suggested filename
                 on_confirm=self._on_confirm_save, # Callback on confirmation
                 on_cancel=lambda: sublime.status_message("Export cancelled.")
            )

        except Exception as e:
            print(f"{PLUGIN_NAME} Error initiating chat history export: {str(e)}")
            sublime.error_message(f"{PLUGIN_NAME}: Could not start chat history export: {e}")

    def find_current_chat_view(self) -> Optional[sublime.View]:
        """Finds the view marked as the current chat view in the window."""
        active_view = self.window.active_view()
        # Prefer the currently focused view if it *is* a chat view
        if active_view and active_view.settings().get('gemini_assistant_is_chat_view', False):
             return active_view

        # If focused view isn't a chat view, find the one marked as current
        for view in self.window.views():
            # Use renamed settings keys
            if (view.settings().get('gemini_assistant_is_chat_view', False) and
                view.settings().get('gemini_assistant_is_current_chat', False)):
                return view
        # Fallback: return the first chat view found if no focused/current one
        for view in self.window.views():
             if view.settings().get('gemini_assistant_is_chat_view', False):
                  print(f"{PLUGIN_NAME} Warning: No focused or current chat view, exporting first one found.")
                  return view
        return None

    def _on_confirm_save(self, path: Optional[str]):
        """Callback executed when the user confirms the save location."""
        if not path: # Should not happen with on_confirm, but check
            sublime.status_message("Export cancelled or no path provided.")
            return

        # Ensure the path ends with .json (optional, save dialog might do this)
        if not path.lower().endswith('.json'):
            path += '.json'

        try:
            gemini_assistant_save_last_directory(path) # Use renamed util to save directory

            # Prepare data structure for export
            export_data = {
                "exported_by": f"{PLUGIN_NAME} Sublime Text Plugin",
                # Could add metadata: export timestamp, model used (if stored), etc.
                # "timestamp_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'messages': self.messages_to_export # Use the messages stored from run()
            }

            # --- Write to File ---
            with open(path, 'w', encoding='utf-8') as f:
                # Use indent for readability of the exported JSON
                json.dump(export_data, f, indent=4, ensure_ascii=False)

            sublime.status_message(f"{PLUGIN_NAME}: Chat history exported successfully to {os.path.basename(path)}")

        # --- Error Handling ---
        except IOError as e:
             sublime.error_message(f"Error saving file: Could not write to '{path}'. Check permissions. ({e.strerror})")
        except Exception as e:
            print(f"{PLUGIN_NAME} Error saving chat history: {type(e).__name__}: {str(e)}")
            # import traceback; traceback.print_exc() # For debugging
            sublime.error_message(f"Could not save chat history - An unexpected error occurred: {str(e)}")


# Renamed command
class GeminiAssistantClearChatHistoryCommand(sublime_plugin.TextCommand):
    """Clears the conversation history stored in the settings of the current chat view."""

    def run(self, edit):
        """Executes the clear history action."""
        window = self.view.window() # Get window from the command's view
        if not window:
            print(f"{PLUGIN_NAME} Error: Cannot clear history, command's view has no window.")
            return

        # Find the chat view this command should operate on
        # (Prefer the view the command was invoked on if it's a chat view)
        chat_view_to_clear = self.find_target_chat_view(window)

        if chat_view_to_clear:
             # --- Confirmation Dialog ---
            if sublime.ok_cancel_dialog(
                 "⚠️ Clear Gemini Chat History?\n\n"
                 "This will clear the conversation stored for this specific chat tab. "
                 "Future messages in this tab will start a new conversation context.\n\n"
                 "This action cannot be undone.",
                 "Clear History" # OK button text
             ):
                try:
                    # --- Clear the Conversation History Setting ---
                    # Use the renamed setting key
                    chat_view_to_clear.settings().set('gemini_assistant_conversation_json', '[]')

                    # --- Clear Context Files Setting? (Optional - decide if desired) ---
                    # If you want "Clear History" to also remove associated context files:
                    # chat_view_to_clear.settings().set('gemini_assistant_context_files', {})
                    # status_msg_suffix = " and included files context."
                    status_msg_suffix = "."

                    # --- User Feedback ---
                    # Use the renamed status message utility, targeting the correct window
                    gemini_assistant_chat_status_message(
                        window, # Target the window where the view exists
                        f"Chat history cleared{status_msg_suffix} Future messages will start a new conversation.",
                        "✅" # Prefix icon
                    )
                    sublime.status_message("Gemini chat history cleared.")

                except Exception as e:
                     print(f"{PLUGIN_NAME} Error clearing history settings: {e}")
                     sublime.error_message(f"Failed to clear chat history: {e}")
            else:
                 # User cancelled the dialog
                 sublime.status_message("Clear history cancelled.")
        else:
            # No relevant chat view found
            sublime.status_message("No active Gemini chat view found to clear.")

    def find_target_chat_view(self, window: sublime.Window) -> Optional[sublime.View]:
        """
        Finds the chat view this command should operate on.
        Prioritizes the view the command was invoked from (self.view),
        then the view marked as 'current', then the first chat view found.
        """
        # 1. Check if the command's own view is a chat view
        if self.view.settings().get('gemini_assistant_is_chat_view', False):
            return self.view

        # 2. Find the view marked as the current chat view in the window
        for view in window.views():
            if (view.settings().get('gemini_assistant_is_chat_view', False) and
                view.settings().get('gemini_assistant_is_current_chat', False)):
                return view

        # 3. Fallback: Find the first chat view in the window (less ideal)
        for view in window.views():
             if view.settings().get('gemini_assistant_is_chat_view', False):
                  print(f"{PLUGIN_NAME} Warning: No specific target chat view found for Clear History, using first available.")
                  return view

        return None # No chat view found at all

    def is_enabled(self) -> bool:
        """Enable command only if the target chat view has history."""
        window = self.view.window()
        if not window: return False
        target_view = self.find_target_chat_view(window)
        if not target_view: return False

        # Check if the history setting exists and is not empty ('[]')
        # Use renamed setting key
        history = target_view.settings().get('gemini_assistant_conversation_json', '[]')
        # Ensure it's a non-empty string and not just '[]'
        return isinstance(history, str) and history.strip() and history != '[]'

    def is_visible(self) -> bool:
        """Show command only if the active view *could* be a chat view context."""
        # More accurately, show if *any* chat view exists in the window?
        # Or just tie visibility to the active view being a chat view?
        # Let's make it visible if the active view IS a chat view.
        return self.view.settings().get('gemini_assistant_is_chat_view', False)