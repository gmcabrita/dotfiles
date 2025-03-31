import sublime
import sublime_plugin
import threading
from ..constants import PLUGIN_NAME, SETTINGS_FILE
from ..api.google_api import GeminiAssistantGoogleAPI # Renamed API import
from ..api.handler import GeminiAssistantStreamingResponseHandler # Renamed Handler import
from .chat_view import GeminiAssistantChatView # Renamed ChatView import
from typing import Union

# Renamed command
class GeminiAssistantAskQuestionCommand(sublime_plugin.TextCommand):
    """Handles asking a question to Gemini, either in the current or a new chat view."""
    def __init__(self, view):
        super().__init__(view)
        # chat_view_manager will hold the GeminiAssistantChatView instance for the window
        self.chat_view_manager: Union[GeminiAssistantChatView, None] = None
        self.settings = None
        # self.view is the view this command was invoked from (provided by ST)

    def load_settings(self):
        """Loads or reloads the package settings."""
        if not self.settings:
            self.settings = sublime.load_settings(SETTINGS_FILE)
        # Could add logic to reload settings if necessary:
        # sublime.load_settings(SETTINGS_FILE)

    def get_window(self) -> Union[sublime.Window, None]:
        """Gets the window associated with the command's view, or the active window."""
        # Prefer the window of the view the command runs on
        window = self.view.window()
        if window:
            return window
        # Fallback to active window if the view doesn't have one (rare)
        return sublime.active_window()

    def is_visible(self):
        """Command is always visible in the palette."""
        return True

    def is_enabled(self):
        """Command is enabled if a window exists."""
        # Could add check for API key here, but might slow down palette
        return bool(self.get_window())

    def get_chat_view_manager(self, force_new=False) -> bool:
        """
        Gets or creates the GeminiAssistantChatView manager for the window.
        If not force_new, it ensures a chat view exists and assigns it to the manager.
        If force_new, it tells the manager to create a new sublime.View next time.

        Returns True if the manager is successfully obtained/configured, False otherwise.
        Assigns the manager instance to self.chat_view_manager.
        """
        window = self.get_window()
        if not window:
            print(f"{PLUGIN_NAME} Error: No active window found.")
            sublime.error_message(f"{PLUGIN_NAME} Error: No active window found.")
            return False

        self.load_settings() # Ensure settings are loaded

        try:
            # Get the singleton manager instance for this window
            manager = GeminiAssistantChatView.get_instance(window, self.settings)
            if not manager:
                 print(f"{PLUGIN_NAME} Error: Could not get ChatView manager instance.")
                 sublime.error_message(f"{PLUGIN_NAME} Error: Failed to initialize chat manager.")
                 return False

            self.chat_view_manager = manager # Store the manager instance

            if force_new:
                 # The manager will handle creating a new view when create_or_get_view is called next
                 # We don't create the view itself here, just ensure the manager is ready
                 return True
            else:
                 # Ensure a view exists for the non-force_new case
                 sublime_view = self.chat_view_manager.create_or_get_view()
                 return bool(sublime_view) # Return True if view exists/was created

        except Exception as e:
            print(f"{PLUGIN_NAME} Error getting/creating chat view manager: {str(e)}")
            sublime.error_message(f"{PLUGIN_NAME} Error: Could not initialize chat view: {e}")
            return False

    def handle_input(self, code: str, question: str):
        """
        Callback executed after user enters text in the input panel.
        Args:
            code (str): Text selected in the original view when command was invoked.
            question (str): Text entered by the user in the input panel.
        """
        if not question or not question.strip():
            sublime.status_message("Question cannot be empty.")
            return

        # get_chat_view_manager ensures self.chat_view_manager is set if successful
        if not self.get_chat_view_manager():
            # Error message shown by get_chat_view_manager
            return

        # Ensure the manager has an associated view (should have been created by get_chat_view_manager)
        if not self.chat_view_manager.view or not self.chat_view_manager.view.is_valid():
             sublime_view = self.chat_view_manager.create_or_get_view()
             if not sublime_view:
                  sublime.error_message(f"{PLUGIN_NAME} Error: Failed to get a valid chat view.")
                  return

        # Check API key *after* ensuring the view manager is ready
        if not self.settings.get('api_key'):
            # Use the chat view manager instance to append text
            self.chat_view_manager.append_text(
                "\n\n" # Add spacing
                "**Error:** A Google AI API key is required.\n"
                "Please add your API key via menu:\n"
                "`Preferences` -> `Package Settings` -> `Gemini Assistant` -> `Settings`\n"
            )
            # Focus the view to show the message
            self.chat_view_manager.focus()
            return

        # Proceed to send the request
        self.send_to_google_ai(code, question.strip()) # Renamed method


    def run(self, edit, code=None, question=None, force_new=False):
        """
        Entry point for the command. Can be called directly with args or interactively.
        Args:
            edit: Sublime Text edit object (ignore).
            code (str, optional): Pre-filled code context.
            question (str, optional): Pre-filled question.
            force_new (bool): If True, forces creation of a new chat view.
        """
        try:
            self.load_settings() # Load settings first

            # Handle direct invocation with args (e.g., from other commands/plugins)
            # If called directly, we need to ensure a chat view manager and view exist.
            if code is not None or question is not None:
                if not self.get_chat_view_manager(force_new=force_new):
                    return # Error handled within
                # Ensure question is not None if code is provided
                question = question or ""
                self.send_to_google_ai(code or "", question)
                return

            # --- Standard Interactive Flow ---
            window = self.get_window()
            if not window:
                 print(f"{PLUGIN_NAME} Error: No active window for interactive command.")
                 # Don't show error message for this common case?
                 return

            # --- Get Selection from the *original* view (self.view) ---
            selected_text = ""
            # Check if self.view is valid and has selections
            if self.view and self.view.is_valid() and self.view.sel():
                sel = self.view.sel()
                # Ensure there's a selection and it's not empty
                if len(sel) > 0 and not sel[0].empty():
                    selected_text = self.view.substr(sel[0])

            # --- Show Input Panel ---
            panel_caption = "Ask Gemini (New Chat):" if force_new else "Ask Gemini:"
            # The input panel runs, and its callback `handle_input` will create the
            # chat view manager and panel *if needed* before sending.
            input_view = window.show_input_panel(
                panel_caption, # Input panel title
                "", # Initial text
                lambda q: self.handle_input(selected_text, q), # On Done callback
                None, # On Change callback (optional)
                None  # On Cancel callback (optional)
            )

            # Optional: Focus the input panel if created successfully
            # if input_view: window.focus_view(input_view)

        except Exception as e:
            print(f"{PLUGIN_NAME} Error in '{'New Question' if force_new else 'Ask Question'}' run: {type(e).__name__}: {str(e)}")
            # import traceback; traceback.print_exc(); # For detailed debugging
            sublime.error_message(f"{PLUGIN_NAME} Error: Could not process request: {e}")

    def send_to_google_ai(self, code: str, question: str): # Renamed method
        """
        Formats the message, updates history, and initiates the API call thread.
        Assumes self.chat_view_manager is already initialized.

        Args:
            code (str): Code snippet context (can be empty).
            question (str): The user's question.
        """
        if not self.chat_view_manager or not self.chat_view_manager.view:
            print(f"{PLUGIN_NAME} Error: Chat view manager or view not available for sending.")
            sublime.error_message(f"{PLUGIN_NAME} Error: Chat view not ready.")
            return
        if not self.chat_view_manager.view.is_valid():
             print(f"{PLUGIN_NAME} Error: Chat view is invalid for sending.")
             sublime.error_message(f"{PLUGIN_NAME} Error: Chat view closed or invalid.")
             return

        # Get the sublime view object from the manager
        sublime_chat_view = self.chat_view_manager.view

        try:
            # --- Prepare Message for Display in Chat View ---
            # Check if view already has content
            display_prefix = "\n\n" if self.chat_view_manager.get_size() > 0 else ""
            display_message = f"{display_prefix}## Question\n\n{question}\n\n"

            if code and code.strip():
                # Format selected code nicely for display
                # Add language hint if possible? Maybe too complex here.
                display_message += f"### Provided Code Snippet\n\n```\n{code.strip()}\n```\n\n"

            display_message += "### Gemini's Response\n\n" # Renamed

            # --- Prepare Message Content for API ---
            # Combine question and code for the actual 'user' message content sent to API
            user_api_content = question
            if code and code.strip():
                 # Append code context clearly separated for the AI
                user_api_content += f"\n\n--- Start of Provided Code Snippet ---\n{code.strip()}\n--- End of Provided Code Snippet ---"

            # --- Update Conversation History (using the manager) ---
            # Add user message (with combined content), get full history for API call
            # handle_question returns the list of messages for the API
            conversation_history = self.chat_view_manager.handle_question(user_api_content)

            # --- Append Display Message to View (using the manager) ---
            self.chat_view_manager.append_text(display_message)
            self.chat_view_manager.focus() # Focus the chat view

            # --- Initiate API Call ---
            api = GeminiAssistantGoogleAPI() # Renamed API class

            # Record the start position in the view *before* streaming starts
            response_start_point = sublime_chat_view.size()

            # --- Define Completion Callback ---
            # This runs *after* the streaming handler has finished processing all chunks
            def on_api_complete():
                # The handler already called self.chat_view_manager.handle_response with full text
                # We just need to trigger post-processing in the ChatView manager
                if self.chat_view_manager:
                    # This updates buttons, fixes code blocks, etc.
                    self.chat_view_manager.on_streaming_complete()

            # --- Create Streaming Handler Instance ---
            handler = GeminiAssistantStreamingResponseHandler(
                view=sublime_chat_view, # Pass the sublime.View object
                chat_view=self.chat_view_manager, # Pass the manager instance
                on_complete=on_api_complete # Pass the completion callback
            )

            # --- Start API Call in Background Thread ---
            thread = threading.Thread(
                target=api.stream_response,
                # Pass the handler's append method, the history, and the sublime view for context lookup
                args=(handler.append_chunk, conversation_history, sublime_chat_view),
                daemon=True # Allow Sublime Text to exit even if thread is running
            )
            thread.start()

        except Exception as e:
            print(f"{PLUGIN_NAME} Error sending to Google AI: {type(e).__name__}: {str(e)}")
            # import traceback; traceback.print_exc(); # For detailed debugging
            sublime.error_message(f"{PLUGIN_NAME} Error: Could not send message to Google AI: {e}")
            # Append error to chat view?
            if self.chat_view_manager:
                 self.chat_view_manager.append_text(f"\n\n**Error:** Failed to send message. Check console for details.")


# Renamed command for asking in a new chat view
class GeminiAssistantAskNewQuestionCommand(sublime_plugin.TextCommand):
    """Handles the 'Ask Question In New Chat View' command."""
    def run(self, edit):
        """Forces the creation of a new chat view before asking."""
        # We achieve this by calling the main AskQuestion command's run method
        # with the `force_new=True` argument.
        window = self.view.window() or sublime.active_window()
        if not window:
             print(f"{PLUGIN_NAME} Error: No window context for AskNewQuestion.")
             return

        # Directly invoke the run method of the other command instance
        # Need to create an instance first, passing the current view
        ask_cmd_instance = GeminiAssistantAskQuestionCommand(self.view)
        # Call its run method, passing the force_new flag
        ask_cmd_instance.run(edit, force_new=True)

    def is_enabled(self):
        """Enabled if a window exists."""
        return bool(self.view.window() or sublime.active_window())