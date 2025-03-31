import json
import sublime
import sublime_plugin
import re
from typing import List, Dict, Any, Optional, Set
from dataclasses import dataclass
from ..constants import PLUGIN_NAME # Ensure PLUGIN_NAME is updated if needed

@dataclass
class GeminiAssistantCodeBlock: # Renamed
    """Represents a code block found in the chat content."""
    content: str
    start_pos: int
    end_pos: int
    language: str

# Renamed listener
class GeminiAssistantChatViewListener(sublime_plugin.ViewEventListener):
    """Event listener specifically for Gemini chat views."""

    @classmethod
    def is_applicable(cls, settings):
        """Only attach this listener to Gemini chat views."""
        # Use renamed setting key
        return settings.get('gemini_assistant_is_chat_view', False)

    def on_text_command(self, command_name, args):
        """Handle enter key press in the chat view to trigger ask question."""
        # Check if the command is an insertion of a newline character
        if command_name == "insert" and args.get("characters") == "\n":
            # Ensure the cursor is at the end of the view before triggering
            # This prevents accidental triggers when editing past responses (though view is read-only)
            last_point = self.view.size()
            # Check if *any* selection region ends at the last point
            # More robust: check if *all* cursors are at the very end.
            at_end = all(sel.begin() == last_point and sel.end() == last_point for sel in self.view.sel())

            if at_end:
                try:
                    window = self.view.window()
                    if window:
                        # Trigger the renamed ask question command
                        # Pass the current view to the command context
                        window.run_command('gemini_assistant_ask_question', {"view_id": self.view.id()}) # Pass view context if needed by cmd
                        # Prevent the default newline insertion by returning noop
                        return ('noop', None)
                except Exception as e:
                    print(f"{PLUGIN_NAME} Error handling Enter key: {str(e)}")
                    sublime.status_message(f"{PLUGIN_NAME} error: {str(e)}")
            # else: Enter pressed somewhere else, allow default behavior

        # Allow other text commands to proceed normally
        return None

    def on_modified(self):
         """Handle view modifications, potentially for read-only enforcement."""
         # This listener might trigger frequently during streaming appends.
         # If the view is supposed to be read-only, this can help enforce it,
         # though set_read_only(True) should handle most cases.
         if self.view.is_read_only():
              # Could potentially revert changes here if needed, but might be complex and slow.
              # print(f"Modification detected on read-only view {self.view.id()}")
              pass

    def on_close(self):
        """Clean up resources when the chat view is closed."""
        # This method is part of the listener attached to the view.
        # When the view closes, this listener instance is destroyed.
        window = self.view.window()
        if window:
            # Attempt to find the manager instance for the window and call destroy
            manager = GeminiAssistantChatView.get_instance(window) # Get instance without settings
            if manager:
                 # Tell the manager to clean up resources for *this specific view*
                 manager.destroy_view_resources(self.view)

# Renamed class
class GeminiAssistantChatView:
    """
    Manages chat view state and interaction for a specific Sublime Text window.
    Acts as a singleton per window.
    """

    _instances: Dict[int, 'GeminiAssistantChatView'] = {} # Window ID -> Instance

    @classmethod
    def get_instance(cls, window: Optional[sublime.Window] = None, settings: Optional[sublime.Settings] = None) -> Optional['GeminiAssistantChatView']:
        """Get or create a chat view manager instance for the given window."""
        if window is None:
            window = sublime.active_window()
            if window is None:
                 print(f"{PLUGIN_NAME} Error: Cannot get instance without a window.")
                 return None # Return None if no window available

        window_id = window.id()

        if window_id not in cls._instances:
            # print(f"{PLUGIN_NAME} Debug: Creating new ChatView manager for window {window_id}")
            _settings = settings or sublime.load_settings(SETTINGS_FILE)
            if not _settings:
                 print(f"{PLUGIN_NAME} Error: Cannot create instance without settings for window {window_id}.")
                 return None # Return None if settings cannot be loaded
            cls._instances[window_id] = cls(window, _settings)
        # else: print(f"{PLUGIN_NAME} Debug: Returning existing ChatView manager for window {window_id}")

        # Optionally update settings if provided for an existing instance
        if settings and window_id in cls._instances:
             cls._instances[window_id].settings = settings

        return cls._instances[window_id]

    # @classmethod
    # def cleanup_all_instances(cls):
    #      """Method to explicitly clean up all managed instances (e.g., on plugin unload)."""
    #      print(f"{PLUGIN_NAME}: Cleaning up all ChatView manager instances...")
    #      # Iterate over a copy of keys as `destroy` modifies the dictionary
    #      instance_ids = list(cls._instances.keys())
    #      for window_id in instance_ids:
    #           instance = cls._instances.get(window_id)
    #           if instance:
    #                instance.destroy() # Call destroy on each instance
    #      cls._instances.clear()


    def __init__(self, window: sublime.Window, settings: sublime.Settings):
        """Initialize the chat view manager for a specific window."""
        if not isinstance(window, sublime.Window):
             raise TypeError("Window must be a sublime.Window instance")
        if not isinstance(settings, sublime.Settings):
             raise TypeError("Settings must be a sublime.Settings instance")

        self.window = window
        self.settings = settings
        # self.view will reference the *most recently created or focused* chat view in this window
        self.view: Optional[sublime.View] = None
        # Store phantoms and positions per view ID within this window manager
        self.phantom_sets: Dict[int, sublime.PhantomSet] = {} # view_id -> PhantomSet
        self.existing_button_positions: Dict[int, Set[int]] = {} # view_id -> {position}
        # print(f"{PLUGIN_NAME}: Initialized ChatView manager for window {window.id()}")

    def destroy_view_resources(self, view: sublime.View):
         """Clean up resources specifically associated with a closing or removed view."""
         if not view or not view.is_valid():
              # print(f"{PLUGIN_NAME} Debug: Attempted to destroy resources for invalid view.")
              return # Cannot cleanup if view is invalid

         view_id = view.id()
         # print(f"{PLUGIN_NAME}: Destroying resources for view {view_id} in window {self.window.id()}")

         # Clean up Phantoms
         if view_id in self.phantom_sets:
             try:
                 # Ensure PhantomSet is cleared before deleting reference
                 self.phantom_sets[view_id].update([])
             except Exception as e:
                 # Log error but continue cleanup
                 print(f"{PLUGIN_NAME} Error clearing phantom set for view {view_id}: {e}")
             finally:
                 # Remove the PhantomSet reference
                 del self.phantom_sets[view_id]
                 # print(f"{PLUGIN_NAME} Debug: Removed phantom set for view {view_id}")

         # Clean up Button Positions tracking
         if view_id in self.existing_button_positions:
             del self.existing_button_positions[view_id]
             # print(f"{PLUGIN_NAME} Debug: Removed button positions for view {view_id}")

         # If the closing view was the 'active' one for this manager, reset reference
         if self.view and self.view.id() == view_id:
             self.view = None
             # print(f"{PLUGIN_NAME} Debug: Reset active view reference for window manager {self.window.id()}")


    def create_or_get_view(self) -> Optional[sublime.View]:
        """
        Finds the current chat view in the window, or creates a new one if none exists.
        Sets self.view to the found or created view and ensures it's marked as current.
        Returns the sublime.View object.
        """
        if not self.window or not self.window.is_valid():
             print(f"{PLUGIN_NAME} Error: Cannot create/get view, window is invalid.")
             return None

        # --- Find Existing Chat View ---
        current_chat_view: Optional[sublime.View] = None
        first_chat_view: Optional[sublime.View] = None

        for view in self.window.views():
            if view.settings().get('gemini_assistant_is_chat_view', False):
                 if not first_chat_view: first_chat_view = view # Track the first one found
                 if view.settings().get('gemini_assistant_is_current_chat', False):
                      current_chat_view = view
                      break # Found the current one

        target_view = current_chat_view or first_chat_view

        if target_view and target_view.is_valid():
             # Found an existing view, make sure it's marked as current
             self.view = target_view
             if not self.view.settings().get('gemini_assistant_is_current_chat', False):
                  # Mark it current and unmark others
                  self._mark_view_as_current(self.view)
             # print(f"{PLUGIN_NAME}: Using existing chat view {self.view.id()} for window {self.window.id()}")
             return self.view

        # --- Create New Chat View if None Exists ---
        # print(f"{PLUGIN_NAME}: No existing chat view found in window {self.window.id()}, creating new one.")
        try:
            new_view = self.window.new_file(flags=sublime.TRANSIENT) # Open as transient initially?
            if not new_view:
                print(f"{PLUGIN_NAME} Error: Could not create new file for chat view")
                sublime.error_message(f"{PLUGIN_NAME} Error: Could not create new file")
                return None

            self.view = new_view # Assign the new view to the manager

            # Apply settings from config file
            chat_settings = self.settings.get('chat', {})
            line_numbers = chat_settings.get('line_numbers', False)
            rulers = chat_settings.get('rulers', []) # Rulers: list of column numbers
            set_scratch = chat_settings.get('set_scratch', True)

            self.view.set_name("Gemini Chat") # Renamed
            if set_scratch:
                 self.view.set_scratch(True) # Doesn't prompt to save on close
            self.view.assign_syntax('Packages/Markdown/Markdown.sublime-syntax')

            # Start read-only
            self.view.set_read_only(True)
            # Apply view-specific settings
            vs = self.view.settings()
            vs.set("line_numbers", line_numbers)
            vs.set("rulers", rulers if isinstance(rulers, list) else [])
            vs.set("gutter", line_numbers) # Gutter visibility tied to line numbers
            vs.set("draw_centered", False) # Typically false for chat logs
            vs.set("word_wrap", True) # Usually desired for chat
            vs.set("wrap_width", 0) # Wrap at window width if word_wrap is true
            vs.set("margin", 2) # Small margin
            vs.set("scroll_past_end", False) # Don't scroll past the end
            # Mark it as a chat view and the current one
            vs.set("gemini_assistant_is_chat_view", True)
            # Initialize conversation history setting (must be JSON serializable)
            vs.set("gemini_assistant_conversation_json", "[]")
            # Initialize context files setting (must be JSON serializable)
            vs.set("gemini_assistant_context_files", {}) # Store as dict

            # Mark this new view as current and unmark others
            self._mark_view_as_current(self.view)

            # print(f"{PLUGIN_NAME}: Created new chat view {self.view.id()} for window {self.window.id()}")
            return self.view

        except Exception as e:
            print(f"{PLUGIN_NAME} Error creating new chat view: {str(e)}")
            sublime.error_message(f"{PLUGIN_NAME} Error: Could not create chat view: {e}")
            return None

    def _mark_view_as_current(self, target_view: sublime.View):
         """Marks the target view as current and unmarks others in the same window."""
         if not target_view or not target_view.is_valid(): return
         window = target_view.window()
         if not window: return

         target_view_id = target_view.id()
         target_view.settings().set('gemini_assistant_is_current_chat', True)

         # Unset flag on other views in the *same* window
         for view in window.views():
              if view.id() != target_view_id and view.settings().get('gemini_assistant_is_chat_view', False):
                   view.settings().set('gemini_assistant_is_current_chat', False)


    def get_phantom_set(self, view: sublime.View) -> Optional[sublime.PhantomSet]:
        """Get or create a phantom set for the specific view."""
        if not view or not view.is_valid(): return None

        view_id = view.id()
        if view_id not in self.phantom_sets:
            # Ensure the view is still valid *before* creating PhantomSet
            if not view.is_valid():
                 print(f"{PLUGIN_NAME} Error: Attempted to create PhantomSet for invalid view {view_id}")
                 self.destroy_view_resources(view) # Clean up if view became invalid
                 return None
            try:
                 # Use a unique key per view for the PhantomSet
                 self.phantom_sets[view_id] = sublime.PhantomSet(view, f"gemini_code_block_buttons_{view_id}") # Renamed key
            except Exception as e:
                 print(f"{PLUGIN_NAME} Error creating PhantomSet for view {view_id}: {e}")
                 return None # Failed to create
        return self.phantom_sets[view_id]

    def get_button_positions(self, view: sublime.View) -> Set[int]:
        """Get or create a set tracking phantom button positions for the specific view."""
        if not view: return set() # Return empty set if no view
        view_id = view.id()
        if view_id not in self.existing_button_positions:
            self.existing_button_positions[view_id] = set()
        return self.existing_button_positions[view_id]

    def get_conversation_history(self) -> List[Dict[str, Any]]:
        """Get the conversation history (user/assistant roles) from the current view's settings."""
        # Use the currently managed view (self.view)
        active_view = self.view or self.create_or_get_view() # Ensure a view exists
        if not active_view or not active_view.is_valid():
            # print(f"{PLUGIN_NAME} Warning: Cannot get history, manager's view is not set or invalid.")
            return []

        # Use renamed setting key
        conversation_json = active_view.settings().get('gemini_assistant_conversation_json', '[]')
        try:
            history = json.loads(conversation_json)
            # Basic validation: ensure it's a list
            if isinstance(history, list):
                return history
            else:
                print(f"{PLUGIN_NAME} Error: Conversation history in settings (view {active_view.id()}) is not a list.")
                # Optionally reset the setting if corrupted
                # active_view.settings().set('gemini_assistant_conversation_json', '[]')
                return [] # Return empty list on corruption
        except json.JSONDecodeError:
            print(f"{PLUGIN_NAME} Error: Could not decode conversation history from settings (view {active_view.id()}).")
            return [] # Return empty list on decode error

    def add_to_conversation(self, role: str, content: str):
        """Add a new message (user/assistant role) to the conversation history."""
        active_view = self.view or self.create_or_get_view() # Ensure a view exists
        if not active_view or not active_view.is_valid():
            print(f"{PLUGIN_NAME} Warning: Cannot add to history, view is not set or invalid.")
            return

        # Ensure role is valid internal role
        if role not in ['user', 'assistant']:
            print(f"{PLUGIN_NAME} Error: Invalid role '{role}' for internal conversation history.")
            return

        # Retrieve current history, append, and save back
        conversation = self.get_conversation_history() # Gets history from active_view
        conversation.append({
            "role": role,
            "content": content # Store raw content as received/sent
        })

        try:
            # Store back into the view's settings
            conversation_json = json.dumps(conversation) # No indent needed for storage
            # Use renamed setting key
            active_view.settings().set('gemini_assistant_conversation_json', conversation_json)
        except TypeError as e:
             # This might happen if content is not serializable, though should be string
             print(f"{PLUGIN_NAME} Error: Could not serialize conversation history to JSON: {e}")
        except Exception as e:
             print(f"{PLUGIN_NAME} Error saving conversation history to settings: {e}")


    def handle_question(self, question: str) -> List[Dict[str, Any]]:
        """
        Handle a new user question: add it to history and return the updated history.
        Uses internal 'user' role.
        """
        self.add_to_conversation("user", question)
        return self.get_conversation_history()

    def handle_response(self, response: str):
        """
        Handle the full AI response: add it to history.
        Uses internal 'assistant' role.
        """
        # Add the complete response text received from the streaming handler
        self.add_to_conversation("assistant", response)

    def append_text(self, text: str, scroll_to_end: bool = True):
        """Append text to the currently managed chat view (self.view)."""
        target_view = self.view or self.create_or_get_view() # Ensure view exists
        if not target_view or not target_view.is_valid():
             # print(f"{PLUGIN_NAME} Warning: Cannot append text, manager's view is not set or invalid.")
             return

        was_read_only = target_view.is_read_only()
        try:
            if was_read_only:
                target_view.set_read_only(False)

            # Append using run_command
            target_view.run_command('append', {
                'characters': text,
                'force': True, # Ensure appending works even if read-only was just toggled
                'scroll_to_end': scroll_to_end
            })
        except Exception as e:
             print(f"{PLUGIN_NAME} Error appending text to view {target_view.id()}: {e}")
        finally:
            # Restore read-only state only if it was True initially and view is still valid
            if was_read_only and target_view.is_valid():
                 # Defer setting read-only slightly to avoid race conditions with other events
                 sublime.set_timeout(lambda: target_view.set_read_only(True) if target_view.is_valid() else None, 10)


    def focus(self):
        """Focus the currently managed chat view (self.view)."""
        target_view = self.view or self.create_or_get_view() # Ensure view exists
        if target_view and target_view.is_valid() and target_view.window():
            # Use the view's window to focus the view
            target_view.window().focus_view(target_view)
        # else: print(f"{PLUGIN_NAME} Debug: Cannot focus, view is not set or invalid.")

    def get_size(self) -> int:
        """Return the size of the currently managed chat view's content."""
        # Use the active view reference (self.view)
        return self.view.size() if self.view and self.view.is_valid() else 0

    def clear(self):
        """Clear the content, history, and buttons for the managed chat view (self.view)."""
        target_view = self.view or self.create_or_get_view() # Ensure view exists
        if target_view and target_view.is_valid():
            was_read_only = target_view.is_read_only()
            try:
                 if was_read_only: target_view.set_read_only(False)
                 target_view.run_command('select_all')
                 target_view.run_command('right_delete') # Clear content
                 # Reset conversation history setting
                 target_view.settings().set('gemini_assistant_conversation_json', '[]')
                 # Reset context files setting
                 target_view.settings().set('gemini_assistant_context_files', {})
                 # Clear associated phantoms and button positions
                 self.clear_buttons(target_view) # Pass the specific view
                 print(f"{PLUGIN_NAME}: Cleared chat view {target_view.id()}")
            except Exception as e:
                 print(f"{PLUGIN_NAME}: Error during view clear operation: {e}")
            finally:
                 # Ensure view is read-only again
                 if target_view.is_valid():
                      sublime.set_timeout(lambda: target_view.set_read_only(True) if target_view.is_valid() else None, 10)

        else:
            print(f"{PLUGIN_NAME} Warning: Cannot clear, manager's view is not set or invalid.")


    def clear_buttons(self, view: sublime.View):
        """Clear all existing code block copy buttons for the specified view."""
        if not view or not view.is_valid(): return

        view_id = view.id()
        phantom_set = self.phantom_sets.get(view_id)
        if phantom_set:
             try:
                 phantom_set.update([]) # Clear phantoms from view
             except Exception as e:
                  print(f"{PLUGIN_NAME} Error clearing phantom set for view {view_id}: {e}")
             # Keep the PhantomSet object itself in self.phantom_sets, just clear its contents

        # Clear the tracked positions for this view
        button_positions = self.existing_button_positions.get(view_id)
        if button_positions:
            button_positions.clear()

    def on_streaming_complete(self) -> None:
        """
        Handle tasks after streaming is complete for the managed view (self.view).
        Validates code blocks and updates phantom buttons.
        """
        target_view = self.view # Use the currently managed view
        if not target_view or not target_view.is_valid():
             print(f"{PLUGIN_NAME} Warning: Cannot run streaming complete logic, view is invalid or not set.")
             return

        # print(f"{PLUGIN_NAME} Debug: Running streaming complete for view {target_view.id()}")

        # Ensure the view is passed to helper methods
        self.validate_and_fix_code_blocks(target_view)

        # Get resources specific to this view
        phantom_set = self.get_phantom_set(target_view)
        if not phantom_set: # Check if PhantomSet creation failed or view became invalid
             print(f"{PLUGIN_NAME} Error: PhantomSet not available for view {target_view.id()}. Cannot add buttons.")
             return
        button_positions = self.get_button_positions(target_view)

        try:
            # Get full, potentially updated content
            content = target_view.substr(sublime.Region(0, target_view.size()))
            # Find code blocks in the current content
            code_blocks = self.find_code_blocks(content) # Uses renamed CodeBlock class

            new_phantoms: List[sublime.Phantom] = []
            current_run_positions: Set[int] = set() # Track positions for *this* update run

            # Get positions of phantoms currently managed by the PhantomSet
            # Check `phantom.region` validity as views can change unexpectedly
            existing_phantom_positions = {
                 p.region.end() for p in phantom_set.phantoms
                 if p.region and p.region.end() in button_positions # Check against tracked positions
            }

            # --- Create/Update Phantoms for Code Blocks ---
            for block in code_blocks:
                pos = block.end_pos # Position where button should appear
                current_run_positions.add(pos) # Mark this position as having a button now

                # Only add a new phantom if one doesn't already exist at this exact position
                if pos not in existing_phantom_positions:
                    region = sublime.Region(pos, pos) # Phantom attached at the end point
                    # Escape content for HTML attribute
                    escaped_code_attr = self.escape_html_attribute(block.content)
                    # Create button HTML, potentially including language
                    button_html = self.create_button_html(escaped_code_attr, block.language)

                    # Define callback using the raw block content
                    # Need to wrap code in lambda scope properly to capture correct value
                    callback = lambda href, code=block.content: self.handle_copy(code)

                    try:
                        phantom = sublime.Phantom(
                            region,
                            button_html,
                            sublime.LAYOUT_BLOCK, # Place button below the block
                            callback # Use the correctly scoped callback
                        )
                        new_phantoms.append(phantom)
                    except Exception as phantom_create_err:
                         print(f"{PLUGIN_NAME} Error creating phantom at pos {pos}: {phantom_create_err}")

            # --- Determine Final Set of Phantoms ---
            # Keep existing phantoms only if their position corresponds to a block found in this run
            phantoms_to_keep = [p for p in phantom_set.phantoms if p.region.end() in current_run_positions]

            # Combine kept phantoms and newly created phantoms
            final_phantoms = phantoms_to_keep + new_phantoms

            # --- Update the View ---
            # Update the phantom set only if there are changes or initial phantoms
            if final_phantoms or phantom_set.phantoms: # Avoid empty updates if possible
                 phantom_set.update(final_phantoms)
                 # Update the tracked button positions for this view
                 self.existing_button_positions[target_view.id()] = current_run_positions
                 # print(f"{PLUGIN_NAME} Debug: Updated {len(final_phantoms)} phantoms for view {target_view.id()}")

        except Exception as e:
             print(f"{PLUGIN_NAME} Error updating code block buttons for view {target_view.id()}: {type(e).__name__}: {e}")
             # import traceback; traceback.print_exc();


    def handle_copy(self, code: str):
        """Copy code to clipboard when a phantom button is clicked."""
        if not isinstance(code, str):
            print(f"{PLUGIN_NAME} Error: Invalid code type for copying.")
            return
        try:
            sublime.set_clipboard(code)
            sublime.status_message("Code copied to clipboard")
        except Exception as e:
            print(f"{PLUGIN_NAME} Error copying to clipboard: {str(e)}")
            sublime.status_message("Error copying code to clipboard")

    # Renamed CodeBlock class used in type hint
    def find_code_blocks(self, content: str) -> List[GeminiAssistantCodeBlock]:
        """Find all markdown code blocks (```...```) in the content."""
        if not isinstance(content, str): return [] # Guard against non-string input

        blocks = []
        # Regex to find ``` optionally followed by language hint, then content, then ```
        # Handles potential whitespace around language name. DOTALL allows '.' to match newlines.
        # Makes language and content non-greedy (.*?) to handle adjacent blocks correctly.
        pattern = r"```[ \t]*(\w*)?\n(.*?)\n```"

        for match in re.finditer(pattern, content, re.DOTALL):
            language = (match.group(1) or '').strip().lower() # Language hint (optional), lowercased
            code_content = match.group(2) # Content is group 2

            # Basic check to exclude empty blocks (only whitespace)
            if code_content is not None and code_content.strip():
                 blocks.append(GeminiAssistantCodeBlock( # Renamed class
                     content=code_content, # Store raw content as captured
                     start_pos=match.start(),
                     end_pos=match.end(),
                     language=language
                 ))
        return blocks

    def validate_and_fix_code_blocks(self, view: sublime.View) -> None:
        """Validate and attempt to fix unclosed markdown code blocks (```) in the specified view."""
        if not view or not view.is_valid(): return

        content = view.substr(sublime.Region(0, view.size()))
        # Simple check: count occurrences of ```
        fence_count = content.count('```')

        # If odd number of fences, the last one is likely unclosed
        if fence_count % 2 != 0:
            print(f"{PLUGIN_NAME}: Found odd number of code fences in view {view.id()}. Appending closing fence.")
            was_read_only = view.is_read_only()
            try:
                if was_read_only: view.set_read_only(False)
                # Append newline if necessary before the fence
                append_chars = "\n```" if not content.endswith("\n") else "```"
                view.run_command('append', {
                    'characters': append_chars,
                    'force': True,
                    'scroll_to_end': True # Scroll might be needed
                })
            except Exception as e:
                 print(f"{PLUGIN_NAME} Error appending closing fence: {e}")
            finally:
                # Restore read-only state
                if was_read_only and view.is_valid():
                     sublime.set_timeout(lambda: view.set_read_only(True) if view.is_valid() else None, 10)


    @staticmethod
    def escape_html_attribute(text: str) -> str:
        """Safely escape text to be used within an HTML attribute value (e.g., href='...')."""
        if not isinstance(text, str): return ""
        # Basic escaping for quotes, ampersand, less than, greater than.
        # Important for values used in href or other attributes.
        return (text
                .replace('&', '&amp;')
                .replace('"', '&quot;')
                .replace('<', '&lt;')
                .replace('>', '&gt;')
                # Newlines and tabs are generally okay in href, but could be encoded if causing issues:
                # .replace('\n', '&#10;') # Optional: encode newline
                # .replace('\t', '&#9;')  # Optional: encode tab
               )

    def create_button_html(self, escaped_code: str, language: str) -> str:
        """Create HTML for the copy button, embedding the escaped code in the href."""
        # Inline styles for simplicity, or use mdpopups CSS variables/classes
        style = """
        <style>
            .gemini-code-block-button {
                margin-top: -2px; /* Adjust spacing */
                margin-bottom: 8px;
                padding-left: 5px; /* Indent slightly */
            }
            .gemini-copy-button {
                display: inline-block; /* Allows padding */
                padding: 1px 6px;
                font-size: 0.8rem; /* Smaller font */
                color: color(var(--foreground) alpha(0.6)); /* Subtle text color */
                background-color: color(var(--background) alpha(0.8)); /* Slightly transparent bg */
                border-radius: 3px;
                border: 1px solid color(var(--foreground) alpha(0.2)); /* Subtle border */
                text-decoration: none; /* No underline */
                opacity: 0.7; /* Dimmed */
                transition: opacity 0.1s ease-in-out, color 0.1s ease-in-out; /* Smooth hover */
            }
            .gemini-copy-button:hover {
                opacity: 1.0; /* Fully opaque on hover */
                color: var(--foreground); /* Brighter text on hover */
                background-color: var(--background);
                border-color: color(var(--foreground) alpha(0.4));
            }
            .gemini-lang-indicator {
                font-size: 0.75rem;
                color: color(var(--foreground) alpha(0.4));
                margin-left: 8px;
                font-style: italic;
            }
        </style>
        """
        # Use a unique href scheme like "copycode:" to avoid conflicts
        # Ensure the escaped code is properly quoted within the href attribute.
        button = f'<a class="gemini-copy-button" title="Copy code block" href="copycode:{escaped_code}">Copy Code</a>'
        # Display language hint if available
        lang_indicator = f'<span class="gemini-lang-indicator">{language}</span>' if language else ''

        return f'{style}<div class="gemini-code-block-button">{button}{lang_indicator}</div>'


    def destroy(self):
        """Clean up all resources managed by this window instance (phantoms, etc.)."""
        # This should be called when the window associated with this manager closes,
        # or during plugin unload.
        if not self.window or not self.window.is_valid():
             # Window might already be gone if called during unload/close events
             # print(f"{PLUGIN_NAME} Debug: Cannot destroy manager, window invalid or None.")
             # Attempt cleanup based on stored IDs anyway?
             pass


        window_id = self.window.id() if self.window else "[Unknown Window]"
        print(f"{PLUGIN_NAME}: Destroying ChatView manager for window {window_id}")

        # Clean up resources for all views managed by this instance
        # Iterate over copies of keys/views as destroy_view_resources modifies the dicts
        view_ids = list(self.phantom_sets.keys())
        for view_id in view_ids:
             # Try to get the view object, but proceed even if invalid to clear dicts
             view = sublime.View(view_id)
             if view.is_valid():
                 self.destroy_view_resources(view)
             else:
                  # Explicitly clean up dictionary entries if view is invalid/gone
                  if view_id in self.phantom_sets: del self.phantom_sets[view_id]
                  if view_id in self.existing_button_positions: del self.existing_button_positions[view_id]

        # Clear the main instance dictionaries
        self.phantom_sets.clear()
        self.existing_button_positions.clear()

        # Remove the instance itself from the class dictionary if it exists
        if window_id in GeminiAssistantChatView._instances:
            try:
                 del GeminiAssistantChatView._instances[window_id]
                 print(f"{PLUGIN_NAME}: Removed ChatView manager instance for window {window_id}")
            except KeyError: pass # Already removed, ignore


        # Break references
        self.view = None
        self.window = None
        self.settings = None