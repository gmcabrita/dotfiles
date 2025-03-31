import sublime
from ..constants import PLUGIN_NAME

class GeminiAssistantStreamingResponseHandler: # Renamed class
    def __init__(self, view, chat_view, on_complete=None):
        """
        Initializes the handler for streaming responses.

        Args:
            view (sublime.View): The Sublime Text view where the response is appended.
            chat_view (GeminiAssistantChatView): The manager instance for the chat view.
            on_complete (callable, optional): Callback function to execute when streaming finishes.
        """
        self.view = view
        self.chat_view = chat_view # Should be an instance of GeminiAssistantChatView
        self.current_response = "" # Accumulates the full response text
        self.on_complete = on_complete
        self.initial_response_received = False # Flag to handle initial empty chunks if any
        self.completed = False # Flag to prevent multiple completions

    def append_chunk(self, chunk: str, is_done: bool = False):
        """
        Appends a chunk of text to the view and updates history on completion.

        Args:
            chunk (str): The piece of text received from the stream.
            is_done (bool): True if this is the final call for this stream.
        """
        if self.completed: # Prevent actions after completion
             return

        # Filter out potential initial empty chunks if needed
        if not self.initial_response_received and not chunk.strip() and not is_done:
             # print(f"{PLUGIN_NAME} Debug: Skipping initial empty chunk.")
             return # Ignore empty initial chunks before actual content arrives

        if chunk:
             self.initial_response_received = True
             self.current_response += chunk

             # --- Append to View ---
             # Ensure appending happens on the main thread and view is valid
             if self.view and self.view.is_valid():
                 was_read_only = self.view.is_read_only()
                 try:
                     if was_read_only:
                          self.view.set_read_only(False)
                     # Use run_command on the view object itself
                     self.view.run_command('append', {
                         'characters': chunk,
                         'force': True, # Necessary if toggling read-only
                         'scroll_to_end': True
                     })
                 except Exception as append_err:
                      print(f"{PLUGIN_NAME} Error appending chunk: {append_err}")
                 finally:
                      # Restore read-only state if it was originally set
                      if was_read_only:
                          sublime.set_timeout(lambda: self.view.set_read_only(True) if self.view.is_valid() else None, 10)
             else:
                  print(f"{PLUGIN_NAME} Warning: Cannot append chunk, view is invalid or None.")


        # --- Handle Completion ---
        if is_done:
            self.completed = True # Mark as completed
            # Ensure response is handled even if it was empty or only whitespace
            if hasattr(self, 'current_response') and self.chat_view:
                # Pass the final accumulated response to the chat view manager
                # The ChatView manager stores it with the 'assistant' role internally
                self.chat_view.handle_response(self.current_response)

                # Call the completion callback if provided
                if self.on_complete:
                    try:
                        # Run on_complete callback (likely updates buttons, etc.)
                        # Ensure it runs on main thread if it modifies UI
                        sublime.set_timeout(self.on_complete, 0)
                    except Exception as complete_err:
                         print(f"{PLUGIN_NAME} Error in on_complete callback: {complete_err}")
            # else: print(f"{PLUGIN_NAME} Debug: is_done received, but no response or chat_view available.")


    def __del__(self):
        """
        Destructor, attempts cleanup if the handler is destroyed mid-stream.
        Note: Destructors in Python are not guaranteed to run reliably.
        """
        # This is a fallback, relying on is_done=True is safer.
        if not self.completed:
            # If destroyed before completion, try to finalize if possible
            # This might happen if the view closes or plugin reloads
            print(f"{PLUGIN_NAME} Warning: StreamingResponseHandler destroyed before completion flag set.")
            # Attempting finalization, but state might be inconsistent
            # try:
            #     if hasattr(self, 'current_response') and self.chat_view:
            #         # Pass whatever we have accumulated
            #         self.chat_view.handle_response(self.current_response)
            #         if self.on_complete:
            #              sublime.set_timeout(self.on_complete, 0)
            # except Exception as del_err:
            #     print(f"{PLUGIN_NAME} Error during handler cleanup (__del__): {del_err}")
            pass # Avoid complex logic in __del__