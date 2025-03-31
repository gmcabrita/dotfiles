import sublime
import json
import urllib.request
import urllib.parse
import urllib.error
import time
import threading # Needed for fetch_models background execution
from ..statusbar.assistant_spinner import AssistantSpinner # Renamed
from ..constants import PLUGIN_NAME, SETTINGS_FILE, DEFAULT_MODEL, MAX_TOKENS # Keep constants or update if needed
from typing import List

class GeminiAssistantGoogleAPI: # Renamed class
    # Google Generative Language API endpoint
    # Using v1beta as it often has the latest models/features
    BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/'

    def __init__(self):
        self.settings = sublime.load_settings(SETTINGS_FILE)
        self.api_key = self.settings.get('api_key')
        # Use max_output_tokens from settings, fallback to constant
        # Ensure MAX_TOKENS is appropriate for Gemini (e.g., 8192)
        self.max_output_tokens = self.settings.get('max_output_tokens', MAX_TOKENS)
        # Ensure DEFAULT_MODEL is a valid Gemini model name
        self.model = self.settings.get('model', DEFAULT_MODEL)
        self.temperature = self.settings.get('temperature', 0.7) # Google default often lower
        self.top_p = self.settings.get('top_p', 0.95)
        self.top_k = self.settings.get('top_k', 40) # Google often suggests 40
        # Removed session cost/token tracking related to Anthropic pricing
        self.spinner = AssistantSpinner() # Renamed spinner instance
        # Removed Anthropic pricing info

    @staticmethod
    def get_valid_temperature(temp):
        try:
            temp = float(temp)
            # Google typically allows 0.0 to 1.0, sometimes up to 2.0, but 0-1 is safe.
            if 0.0 <= temp <= 1.0:
                return temp
            print(f"{PLUGIN_NAME} Warning: Invalid temperature '{temp}', using default 0.7")
            return 0.7 # Default value if invalid
        except (TypeError, ValueError):
            print(f"{PLUGIN_NAME} Warning: Could not parse temperature, using default 0.7")
            return 0.7

    @staticmethod
    def get_valid_top_p(top_p):
        try:
            top_p = float(top_p)
            if 0.0 < top_p <= 1.0: # topP must be > 0 for Google API
                return top_p
            print(f"{PLUGIN_NAME} Warning: Invalid top_p '{top_p}', using default 0.95")
            return 0.95
        except (TypeError, ValueError):
            print(f"{PLUGIN_NAME} Warning: Could not parse top_p, using default 0.95")
            return 0.95

    @staticmethod
    def get_valid_top_k(top_k):
        try:
            top_k = int(top_k)
            if top_k >= 1:
                return top_k
            print(f"{PLUGIN_NAME} Warning: Invalid top_k '{top_k}', using default 40")
            return 40
        except (TypeError, ValueError):
            print(f"{PLUGIN_NAME} Warning: Could not parse top_k, using default 40")
            return 40

    # Removed calculate_cost method
    # Removed should_use_cache_control method
    # Removed MODEL_MAX_TOKENS dictionary

    def format_conversation_history(self, messages: List, chat_view=None) -> List:
        """
        Formats the internal conversation history (user/assistant roles)
        into the Google API's 'contents' format (user/model roles).
        Prepends context files to the *first* user message content.
        Ensures alternating roles, starting with 'user'.
        """
        formatted_contents = []
        context_text = ""

        # --- Prepare context from files ---
        if chat_view:
            # Use renamed setting key
            context_files = chat_view.settings().get('gemini_assistant_context_files', {})
            if context_files:
                context_parts = ["--- Start of Included Context Files ---"]
                for file_path, file_info in context_files.items():
                    # Add guard for missing content
                    content = file_info.get('content', None)
                    if content is not None: # Check for None, allow empty string
                        # Use XML-like tags for clarity
                        context_parts.append(f"<file path=\"{file_path}\">\n{content}\n</file>")
                    else:
                        print(f"{PLUGIN_NAME} Warning: Context file '{file_path}' has missing content.")
                context_parts.append("--- End of Included Context Files ---\n")
                # Only add context_text if there were actual files with content
                if len(context_parts) > 2: # More than start/end markers
                    context_text = "\n".join(context_parts)
                else:
                    print(f"{PLUGIN_NAME} Info: No valid content found in context files.")

        # --- Convert internal roles (user/assistant) to Google roles (user/model) ---
        google_api_messages = []
        for msg in messages:
            role = msg.get('role')
            content = msg.get('content', '').strip()

            if not content: # Skip empty messages
                continue

            google_role = 'user' if role == 'user' else 'model'
            google_api_messages.append({"role": google_role, "parts": [{"text": content}]})

        # --- Ensure alternating roles and prepend context ---
        final_contents = []
        last_role = None
        context_prepended = False

        for item in google_api_messages:
            current_role = item["role"]
            current_content = item["parts"][0]["text"]

            # Prepend context to the very first user message encountered
            if current_role == 'user' and not context_prepended and context_text:
                current_content = context_text + "\n" + current_content # Add context before question
                item["parts"][0]["text"] = current_content
                context_prepended = True

            # Handle role alternation: Merge consecutive messages or skip?
            # Google generally requires user/model alternation.
            if not final_contents:
                # The first message *must* be 'user' for multi-turn chat history
                if current_role == 'model':
                    print(f"{PLUGIN_NAME} Warning: Conversation history cannot start with 'model' role. Skipping initial assistant message(s).")
                    continue # Skip assistant messages until a user message is found
                else:
                    final_contents.append(item)
                    last_role = current_role
            elif current_role != last_role:
                final_contents.append(item)
                last_role = current_role
            else:
                # Consecutive roles of the same type: This violates Gemini's turn structure.
                # Option 1: Merge (simple but might confuse model)
                # Option 2: Skip the current message (safer?)
                print(f"{PLUGIN_NAME} Warning: Skipping consecutive message from role '{current_role}' to maintain turn structure.")
                # final_contents[-1]["parts"][0]["text"] += "\n\n" + current_content # Merge approach
                continue # Skip approach

        # Final check: The last message sent *to* the API in a multi-turn request
        # should be from the 'user'. If the history ends with 'model', the API might error.
        # However, our flow adds the user question *last* before calling, so this usually holds.
        # if final_contents and final_contents[-1]['role'] == 'model':
        #     print(f"{PLUGIN_NAME} Warning: Processed history ends with 'model'. API might require a final 'user' turn.")

        return final_contents


    def stream_response(self, chunk_callback, messages, chat_view=None):
        """
        Sends messages to the Google AI API and streams the response.

        Args:
            chunk_callback: Function to call with each piece of response text.
                            Signature: chunk_callback(text: str, is_done: bool)
            messages: List of internal message history (user/assistant roles).
            chat_view: The sublime.View object of the chat window (for context).
        """

        def handle_error(error_msg, is_final=True):
            """Safely reports errors via the chunk_callback."""
            error_text = f"\n[API Error] {error_msg}"
            print(f"{PLUGIN_NAME} API Error: {error_msg}") # Log detailed error
            # Use sublime.set_timeout to ensure callback runs on main thread
            sublime.set_timeout(lambda: chunk_callback(error_text, is_done=is_final), 0)
            self.spinner.stop() # Stop spinner on error

        if not self.api_key:
            handle_error("API key is not configured in settings.")
            return

        if not messages:
            handle_error("No messages to send.")
            return

        # --- Prepare System Instruction ---
        system_instruction_obj = None
        settings_system_messages = self.settings.get('system_messages', [])
        default_index = self.settings.get('default_system_message_index', 0)

        # Validate index and list
        if (isinstance(settings_system_messages, list) and
            isinstance(default_index, int) and
            0 <= default_index < len(settings_system_messages)):

            selected_message = settings_system_messages[default_index]
            # Ensure it's a non-empty string
            if isinstance(selected_message, str) and selected_message.strip():
                 # Gemini uses system_instruction object at the top level
                 system_instruction_obj = {
                     # Role isn't needed here, just parts
                     "parts": [{"text": selected_message.strip()}]
                 }
        elif default_index != 0 or not settings_system_messages:
             # Handle case where index is invalid but non-zero, or list is empty
             if len(settings_system_messages) > 0 and isinstance(settings_system_messages[0], str) and settings_system_messages[0].strip():
                  print(f"{PLUGIN_NAME} Warning: Invalid system message index, using first available message.")
                  system_instruction_obj = {"parts": [{"text": settings_system_messages[0].strip()}]}
             # else: No valid system message found or selected empty ""


        # --- Format Conversation History (incl. context files) ---
        # Pass the sublime.View object (chat_view) for context lookup
        formatted_contents = self.format_conversation_history(messages, chat_view)

        if not formatted_contents:
             # format_conversation_history might return empty if input `messages` was empty or only assistant roles initially.
             handle_error("Formatted conversation history is empty or invalid.")
             return
        # Ensure the conversation starts with 'user' role after formatting
        if formatted_contents[0]['role'] != 'user':
             handle_error("Conversation history must start with a 'user' role.")
             return


        # --- Prepare API Request ---
        try:
            self.spinner.start(f'Asking {self.model.replace("models/","")}') # Show model name briefly

            # Construct the API URL for streaming
            # Ensure self.model has the format "models/..." or just the ID if base URL needs it
            model_path = self.model if self.model.startswith("models/") else f"models/{self.model}"
            api_url = urllib.parse.urljoin(self.BASE_URL, f'{model_path}:streamGenerateContent')
            # Add API key as query parameter for simplicity (safer alternative: x-goog-api-key header)
            api_url += f"?key={self.api_key}&alt=sse" # alt=sse ensures Server-Sent Events stream

            headers = {
                'Content-Type': 'application/json',
                # 'x-goog-api-key': self.api_key # Alternative auth method
            }

            # --- Prepare Generation Config ---
            generation_config = {
                "temperature": self.get_valid_temperature(self.temperature),
                "topP": self.get_valid_top_p(self.top_p),
                "topK": self.get_valid_top_k(self.top_k),
                "maxOutputTokens": int(self.max_output_tokens),
                "candidateCount": 1, # We only handle one response candidate
                # "stopSequences": ["\n## Question", "\nUser:"] # Example stop sequences
            }

            # --- Prepare Request Body ---
            request_body = {
                'contents': formatted_contents,
                'generationConfig': generation_config,
                # Safety settings could be added here if needed
                # "safetySettings": [{ "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"}]
            }
            # Add system instruction if present (must be at top level)
            if system_instruction_obj:
                request_body['system_instruction'] = system_instruction_obj

            # --- Validate Request Body Size (Optional but Recommended) ---
            # Google has request size limits (e.g., 2MB). Check before sending.
            try:
                request_json_bytes = json.dumps(request_body).encode('utf-8')
                # Limit usually around 2097152 bytes (2 MiB)
                # Set a slightly lower practical limit
                MAX_REQUEST_SIZE = 2 * 1024 * 1024 - 1024 # Just under 2MB
                if len(request_json_bytes) > MAX_REQUEST_SIZE:
                    handle_error(f"Request size ({len(request_json_bytes)/1024:.1f} KB) exceeds limit (~{MAX_REQUEST_SIZE/1024:.0f} KB). Reduce context files or history.")
                    return
            except Exception as json_err:
                 handle_error(f"Could not serialize request data: {json_err}")
                 return


            # --- Make API Call and Process Stream ---
            full_response_text = ""
            request_obj = urllib.request.Request(
                api_url,
                data=request_json_bytes, # Use validated bytes
                headers=headers,
                method='POST'
            )

            try:
                # Use timeout for the request (e.g., 300 seconds = 5 minutes)
                # Note: This timeout is for the *connection* and initial response,
                # not the entire stream duration. Streaming itself can take longer.
                with urllib.request.urlopen(request_obj, timeout=300) as response:
                    # Check initial response status
                    if response.status != 200:
                         # Try reading error body even on non-200 status
                         error_content = response.read().decode('utf-8', errors='ignore')
                         print(f"{PLUGIN_NAME} API Error {response.status}: {error_content}")
                         handle_error(f"API returned status {response.status}. Check console.", is_final=True)
                         return

                    # Process Server-Sent Events (SSE) stream
                    for line_bytes in response:
                        line = line_bytes.decode('utf-8').strip()

                        if line.startswith('data: '):
                            json_data = line[6:]
                            if not json_data: continue # Skip empty data lines

                            try:
                                data = json.loads(json_data)

                                # --- Extract Text Chunk ---
                                text_chunk = ""
                                usage_metadata = None
                                finish_reason = None
                                safety_ratings = None

                                if 'candidates' in data and data['candidates']:
                                    candidate = data['candidates'][0]
                                    if 'content' in candidate and 'parts' in candidate['content'] and candidate['content']['parts']:
                                        text_chunk = candidate['content']['parts'][0].get('text', '')
                                    finish_reason = candidate.get('finishReason')
                                    safety_ratings = candidate.get('safetyRatings')

                                # Usage metadata might be in the top level or within promptFeedback
                                if 'usageMetadata' in data:
                                     usage_metadata = data['usageMetadata']
                                elif 'promptFeedback' in data and 'usageMetadata' in data['promptFeedback']:
                                     usage_metadata = data['promptFeedback']['usageMetadata']


                                # --- Process Extracted Data ---
                                if text_chunk:
                                    full_response_text += text_chunk
                                    # Send chunk to handler on main thread
                                    sublime.set_timeout(
                                        lambda tc=text_chunk: chunk_callback(tc, is_done=False), 0
                                    )

                                # --- Handle Finish Reason ---
                                # Stop processing if a terminal finish reason is encountered
                                if finish_reason and finish_reason != "FINISH_REASON_UNSPECIFIED" and finish_reason != "NOT_FINISHED":
                                    is_error_finish = False
                                    finish_message = f"\n[Finished: {finish_reason}]"
                                    if finish_reason == "SAFETY":
                                        finish_message = f"\n[Blocked: {finish_reason} - {safety_ratings}]"
                                        print(f"{PLUGIN_NAME}: Response stopped due to safety settings: {safety_ratings}")
                                        is_error_finish = True # Treat safety blocking like an error end
                                    elif finish_reason == "MAX_TOKENS":
                                        finish_message = f"\n[Stopped: Max Tokens]"
                                    elif finish_reason not in ["STOP"]: # Recitation, Other, etc.
                                         print(f"{PLUGIN_NAME}: Response finished with reason: {finish_reason}")
                                         is_error_finish = True # Treat unexpected finishes as potential issues

                                    sublime.set_timeout(lambda fm=finish_message: chunk_callback(fm, is_done=is_error_finish), 0)
                                    # We can potentially break the loop here if finish reason is terminal
                                    # break # Exit loop on terminal finish reason

                                # --- Process Usage Metadata (often comes at the end) ---
                                if usage_metadata:
                                    total_tokens = usage_metadata.get('totalTokenCount', 0)
                                    input_tokens = usage_metadata.get('promptTokenCount', 0)
                                    output_tokens = usage_metadata.get('candidatesTokenCount', 0)
                                    if total_tokens > 0:
                                        status_message = f"Tokens: {input_tokens:,} prompt, {output_tokens:,} completion, {total_tokens:,} total."
                                        # Display in status bar (delayed slightly)
                                        sublime.set_timeout(lambda msg=status_message: sublime.status_message(msg), 200)

                            except json.JSONDecodeError:
                                print(f"{PLUGIN_NAME} Warning: Could not decode JSON data chunk: {json_data}")
                                continue # Skip malformed chunks
                            except Exception as e:
                                print(f"{PLUGIN_NAME} Error processing stream chunk: {e}")
                                continue # Skip problematic chunks

                        elif line.startswith(':'): # SSE comment line, ignore
                            pass
                        elif line: # Potentially other SSE fields like 'id' or 'event', ignore for now
                            pass


                # --- Stream Finished Normally ---
                # Signal completion after the stream loop finishes
                sublime.set_timeout(lambda: chunk_callback("", is_done=True), 0)

            # --- Handle Network/HTTP Errors ---
            except urllib.error.HTTPError as e:
                error_body = "No error body received."
                try:
                    error_body = e.read().decode('utf-8', errors='ignore')
                except Exception as read_err:
                     error_body = f"(Could not read error body: {read_err})"

                print(f"{PLUGIN_NAME} HTTP Error: {e.code} {e.reason}")
                print(f"{PLUGIN_NAME} Error Body: {error_body}")
                # Try parsing Google's structured error
                error_message = f"{e.code} {e.reason}"
                try:
                    error_json = json.loads(error_body)
                    error_message = error_json.get('error', {}).get('message', error_message)
                except json.JSONDecodeError:
                    pass # Keep original error message if body is not JSON
                handle_error(f"{error_message}", is_final=True)

            except urllib.error.URLError as e:
                # Network errors (DNS, connection refused, timeout during connect)
                print(f"{PLUGIN_NAME} URL Error: {e.reason}")
                handle_error(f"Network error: {e.reason}", is_final=True)
            except TimeoutError: # Catch explicit timeout from urlopen
                 print(f"{PLUGIN_NAME} Error: Request timed out.")
                 handle_error("Request timed out connecting to API.", is_final=True)
            except Exception as e:
                # Catch other unexpected errors during the API call/stream processing
                print(f"{PLUGIN_NAME} Unexpected error during API call: {type(e).__name__}: {e}")
                # Include traceback maybe? import traceback; traceback.print_exc()
                handle_error(f"An unexpected error occurred: {e}", is_final=True)
            finally:
                self.spinner.stop() # Ensure spinner stops regardless of outcome

        # --- Handle Errors During Request Preparation ---
        except Exception as e:
            print(f"{PLUGIN_NAME} Error preparing API request: {e}")
            # import traceback; traceback.print_exc() # For debugging prep errors
            sublime.error_message(f"{PLUGIN_NAME}: Error setting up request: {e}")
            self.spinner.stop()
            # Don't call handle_error here as chunk_callback might not be valid yet
            # The error message is sufficient.


    def fetch_models(self):
        """Fetches available models from the Google AI API."""
        if not self.api_key:
             print(f"{PLUGIN_NAME}: Cannot fetch models, API key not set.")
             sublime.error_message(f"{PLUGIN_NAME}: API key not configured. Cannot fetch models.")
             return []

        try:
            sublime.status_message('Fetching available Gemini models...')
            self.spinner.start("Fetching Models") # Start spinner

            # Construct the API URL for listing models
            api_url = urllib.parse.urljoin(self.BASE_URL, 'models')
            # Add API key as query parameter
            api_url += f"?key={self.api_key}&pageSize=1000" # Request large page size

            headers = {
                'Content-Type': 'application/json',
                # 'x-goog-api-key': self.api_key # Alternative auth
            }

            req = urllib.request.Request(
                api_url,
                headers=headers,
                method='GET'
            )

            # Use a reasonable timeout for fetching models (e.g., 30 seconds)
            with urllib.request.urlopen(req, timeout=30) as response:
                if response.status != 200:
                     error_content = "Could not read error body."
                     try: error_content = response.read().decode('utf-8', errors='ignore')
                     except: pass
                     print(f"{PLUGIN_NAME} API Error {response.status} fetching models: {error_content}")
                     sublime.error_message(f"Error fetching models: Status {response.status}. Check console.")
                     self.spinner.stop() # Stop spinner on error
                     return []

                data = json.loads(response.read().decode('utf-8'))

                # Extract model names (IDs) that support content generation
                model_ids = []
                if 'models' in data and isinstance(data['models'], list):
                    for model_info in data['models']:
                        # Check if the model supports the required methods for chat
                        supported_methods = model_info.get('supportedGenerationMethods', [])
                        # Check for either standard or streaming generation support
                        if 'generateContent' in supported_methods or 'streamGenerateContent' in supported_methods :
                             # Prefer 'models/gemini-...' format if available, else use 'name'
                            model_name = model_info.get('name', '') # Format: "models/gemini-2.5-pro-exp-03-25"
                            if model_name.startswith("models/"):
                                model_ids.append(model_name) # Keep full name like models/...
                            elif model_name: # Fallback if prefix is missing but name exists
                                 print(f"{PLUGIN_NAME} Warning: Model '{model_name}' missing 'models/' prefix. Adding it.")
                                 model_ids.append(f"models/{model_name}")


                # Sort models for better display (e.g., pro before flash, latest first)
                model_ids.sort(key=lambda x: (
                     'pro' not in x, # Put 'pro' models first
                     '1.5' not in x, # Then 1.5 models
                     'latest' not in x, # Then 'latest' versions
                     x # Alphabetical fallback
                ))

                sublime.status_message('Gemini models fetched successfully.')
                self.spinner.stop() # Stop spinner on success
                return model_ids

        except urllib.error.HTTPError as e:
            error_body = "(Could not read error body)"
            try: error_body = e.read().decode('utf-8', errors='ignore')
            except: pass
            print(f"{PLUGIN_NAME} HTTP Error fetching models: {e.code} {e.reason}\n{error_body}")
            sublime.error_message(f"API error fetching models: {e.code}. Check API key and console.")
        except urllib.error.URLError as e:
            print(f"{PLUGIN_NAME} URL Error fetching models: {e.reason}")
            sublime.error_message(f"Network error fetching models: {e.reason}")
        except TimeoutError:
             print(f"{PLUGIN_NAME} Error: Timed out fetching models.")
             sublime.error_message("Timed out fetching models from Google AI.")
        except Exception as e:
            print(f"{PLUGIN_NAME} Unexpected error fetching models: {type(e).__name__}: {e}")
            # import traceback; traceback.print_exc() # For debugging
            sublime.error_message(f"An unexpected error occurred fetching models: {e}")
        finally:
            # Ensure spinner stops even if errors occurred during parsing etc.
            if self.spinner.active:
                 self.spinner.stop()
            # Clear status bar after a delay unless spinner showed error
            # sublime.set_timeout(lambda: sublime.status_message(""), 500)

        return [] # Return empty list on any failure