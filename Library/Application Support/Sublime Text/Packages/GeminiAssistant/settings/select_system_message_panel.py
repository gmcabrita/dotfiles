import sublime
import sublime_plugin
from ..constants import SETTINGS_FILE, PLUGIN_NAME

# Renamed command
class GeminiAssistantSelectSystemMessagePanelCommand(sublime_plugin.WindowCommand):
    """
    A command to switch between different system instructions (prompts)
    defined in the GeminiAssistant.sublime-settings file.
    """

    def is_visible(self):
        """Command is always visible."""
        return True

    def is_enabled(self):
         """Enable if system messages setting exists (even if empty)."""
         settings = sublime.load_settings(SETTINGS_FILE)
         # Check if the 'system_messages' key is present in settings
         return settings.has('system_messages')

    def run(self):
        """Displays the quick panel for selecting a system instruction."""
        settings = sublime.load_settings(SETTINGS_FILE)
        system_messages = settings.get('system_messages', []) # Default to empty list

        # --- Validate Settings ---
        if not isinstance(system_messages, list):
             sublime.error_message(f"{PLUGIN_NAME} Error:\n'system_messages' in settings is not a valid list.")
             system_messages = [] # Use empty list as fallback

        current_index_setting = settings.get('default_system_message_index', 0)
        # Ensure index is integer and within bounds
        if not isinstance(current_index_setting, int) or not (0 <= current_index_setting < len(system_messages)):
             # Default to 0 if index is invalid or out of bounds (and list is not empty)
             current_index = 0 if system_messages else -1 # No valid selection if list empty
             if current_index_setting != 0 and system_messages: # Log warning if index was wrong
                  print(f"{PLUGIN_NAME} Warning: Invalid 'default_system_message_index' ({current_index_setting}), defaulting to 0.")
        else:
             current_index = current_index_setting


        # --- Prepare Panel Items ---
        panel_items = []
        # Truncate long messages for display in the quick panel
        for i, msg in enumerate(system_messages):
             # Handle potential non-string entries gracefully
             if not isinstance(msg, str):
                  display_msg = f"[Invalid System Message Entry #{i+1}]"
                  details = "Check GeminiAssistant.sublime-settings"
             elif not msg.strip():
                  # Explicitly label the empty option
                  display_msg = "[No System Instruction]"
                  details = "Sends request without a system instruction."
             else:
                  # Show first line or first ~80 chars for readability
                  first_line = msg.split('\n')[0]
                  display_msg = (first_line[:80] + '...') if len(first_line) > 80 else first_line
                  details = msg # Show full message in details line? Or keep it short?
                  details_short = (msg[:100] + '...') if len(msg) > 100 else msg
                  details = details_short.replace("\n", " ") # Remove newlines for detail line

             # Format for quick panel with details: [Trigger Text, Detail Text]
             panel_items.append([display_msg, details])


        # Add option to manage messages via settings file
        settings_item_text = "⚙️ Manage System Instructions in Settings..."
        settings_item_details = "Opens GeminiAssistant.sublime-settings file"
        panel_items.append([settings_item_text, settings_item_details])

        # --- Define Panel Callback ---
        def on_select(index):
            if index == -1:
                 sublime.status_message("System instruction selection cancelled.")
                 return # User cancelled

            if 0 <= index < len(system_messages):
                 # User selected a system message from the list
                 settings.set('default_system_message_index', index)
                 sublime.save_settings(SETTINGS_FILE) # Save the change persistently
                 selected_display = panel_items[index][0] # Get the display text
                 sublime.status_message(f"System instruction set to: {selected_display}")
            elif index == len(system_messages):
                 # User selected the "Manage/Add..." option (last item)
                 self.window.run_command("edit_settings", {
                     "base_file": "${packages}/" + PLUGIN_NAME + "/" + SETTINGS_FILE,
                     # Provide a helpful default structure for user settings
                     "default": "{\n\t\"api_key\": \"PASTE_YOUR_GOOGLE_AI_API_KEY_HERE\",\n\t\"model\": \"gemini-2.5-pro-exp-03-25\",\n\t\"system_messages\": [\n\t\t\"$0\"\n\t],\n\t\"default_system_message_index\": 0\n}\n",
                     "user_file": "${packages}/User/" + SETTINGS_FILE # Explicitly point to user settings
                 })
            else:
                 # Should not happen with valid indices
                 print(f"{PLUGIN_NAME} Error: Invalid index {index} received from system message quick panel.")

        # --- Show the Panel ---
        self.window.show_quick_panel(
            items=panel_items, # List of [trigger, detail] pairs
            on_select=on_select,
            flags=sublime.KEEP_OPEN_ON_FOCUS_LOST | sublime.MONOSPACE_FONT, # Optional flags
            selected_index=current_index # Pre-select the current index
        )