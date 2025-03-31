import sublime
import sublime_plugin
import threading # Import threading
# Renamed API import
from ..api.google_api import GeminiAssistantGoogleAPI
from ..constants import SETTINGS_FILE, PLUGIN_NAME

# Renamed command
class GeminiAssistantSelectModelPanelCommand(sublime_plugin.WindowCommand):
    """
    A command to switch between different Google Gemini models available via the API.
    Shows a quick panel with models fetched from Google AI.
    """

    def is_visible(self):
        """Command is always visible."""
        return True

    def is_enabled(self):
        """Enable if an API key is potentially set."""
        settings = sublime.load_settings(SETTINGS_FILE)
        # Check if api_key exists and is not empty
        return bool(settings.get('api_key', '').strip())

    def run(self):
        """Fetches models and displays the selection panel."""
        api = GeminiAssistantGoogleAPI() # Use renamed API class
        settings = sublime.load_settings(SETTINGS_FILE)
        # Get current model, remove "models/" prefix for potential display matching
        current_model_full = settings.get('model', '')
        current_model_display = current_model_full.replace("models/", "")

        # --- Fetch Models in Background Thread ---
        def fetch_and_show_panel():
            # Fetch models using the API instance
            # This might take a second or two.
            fetched_models_full = api.fetch_models() # Returns list like ["models/gemini...", ...]

            # --- Process Models on Main Thread ---
            def process_and_display():
                if not fetched_models_full:
                    # fetch_models should have shown an error message if it failed
                    sublime.status_message("Failed to fetch models. Check API key or network.")
                    return # Abort if fetching failed

                # Prepare display names (remove "models/" prefix)
                display_names = [m.replace("models/", "") for m in fetched_models_full]
                # Create a mapping from display name back to full name
                model_map = {display: full for display, full in zip(display_names, fetched_models_full)}

                # --- Determine Initial Selection ---
                selected_index = -1
                if current_model_display in display_names:
                    try:
                        # Find index of the current model in the display list
                        selected_index = display_names.index(current_model_display)
                    except ValueError:
                         pass # Should not happen if check passes, but be safe

                # If current model wasn't found in the fetched list, add it manually
                if selected_index == -1 and current_model_full:
                    # Add the current (but possibly outdated/custom) model to the top
                    not_listed_label = f"{current_model_display} (current, not in fetched list)"
                    display_names.insert(0, not_listed_label)
                    model_map[not_listed_label] = current_model_full # Map it back
                    selected_index = 0
                elif selected_index == -1: # No current model set or found, default selection
                     selected_index = 0 # Default to first item in fetched list


                # --- Define Panel Callback ---
                def on_select(index):
                    if index != -1: # Ensure user made a selection
                        selected_display_name = display_names[index]
                        # Get the full model name (e.g., "models/gemini...") using the map
                        selected_full_model = model_map.get(selected_display_name)

                        if selected_full_model:
                            # Save the selected full model name to settings
                            settings.set('model', selected_full_model)
                            sublime.save_settings(SETTINGS_FILE) # Persist the change
                            # Provide feedback (use the display name)
                            sublime.status_message(f"Gemini model set to: {selected_display_name}")
                        else:
                             # Should not happen if map is correct
                             print(f"{PLUGIN_NAME} Error: Could not map display name '{selected_display_name}' back to full model name.")
                             sublime.error_message("Internal Error: Could not switch model.")


                # --- Show Quick Panel ---
                self.window.show_quick_panel(
                     items=display_names,
                     on_select=on_select,
                     flags=sublime.KEEP_OPEN_ON_FOCUS_LOST, # Optional flag
                     selected_index=selected_index # Pre-select the current model
                )

            # Run panel display logic on the main thread
            sublime.set_timeout(process_and_display, 0)

        # Start the background thread to fetch models
        threading.Thread(target=fetch_and_show_panel, daemon=True).start()