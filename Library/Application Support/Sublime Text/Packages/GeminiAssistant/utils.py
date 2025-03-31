import os
import sublime # Needed for status message function and view checks
from pathlib import Path
from .constants import PLUGIN_NAME # For logging consistency
from typing import Optional, Tuple # For type hinting

# Renamed status message function
def gemini_assistant_chat_status_message(window: Optional[sublime.Window], message: str, prefix: str = "ℹ️") -> None:
    """
    Display a status message appended to the content of the active Gemini chat view.

    Args:
        window: The Sublime Text window instance containing the chat view.
        message (str): The status message to display.
        prefix (str, optional): Icon or text prefix for the message. Defaults to "ℹ️".
    """
    if not window:
        print(f"{PLUGIN_NAME} Error: No window provided for status message.")
        # Fallback: Show in global status bar if no window?
        sublime.status_message(f"{prefix} {message}")
        return

    # --- Find the Active Chat View in the Target Window ---
    current_chat_view = None
    active_view = window.active_view()

    # Prioritize the focused view if it's a chat view
    if active_view and active_view.settings().get('gemini_assistant_is_chat_view', False):
         current_chat_view = active_view
    else:
         # If focused view isn't a chat view, find the one marked 'current'
         for view in window.views():
             if (view.settings().get('gemini_assistant_is_chat_view', False) and
                 view.settings().get('gemini_assistant_is_current_chat', False)):
                 current_chat_view = view
                 break

    if not current_chat_view:
        # Fallback: Find the *first* chat view if no focused/current one found
        for view in window.views():
            if view.settings().get('gemini_assistant_is_chat_view', False):
                 current_chat_view = view
                 # print(f"{PLUGIN_NAME} Info: No current chat view for status msg, using first found: {view.id()}")
                 break

    if not current_chat_view or not current_chat_view.is_valid():
        # If still no valid chat view, show message in status bar as fallback
        # print(f"{PLUGIN_NAME} Info: No active chat view found to display message: '{message}'")
        sublime.status_message(f"{prefix} {message}")
        return

    # --- Append Message to Chat View Content ---
    # Determine necessary newlines based on current content
    current_size = current_chat_view.size()
    if current_size > 0 and not current_chat_view.substr(current_size - 1) == '\n':
         # Add extra newline if view doesn't end with one
         formatted_message = f"\n\n{prefix} {message}\n"
    elif current_size > 0:
         # Add standard preceding newline if view already ends with one
         formatted_message = f"\n{prefix} {message}\n"
    else:
         # No preceding newlines if view is empty
        formatted_message = f"{prefix} {message}\n"

    # Append the formatted message
    was_read_only = current_chat_view.is_read_only()
    try:
        if was_read_only:
             current_chat_view.set_read_only(False)

        current_chat_view.run_command('append', {
            'characters': formatted_message,
            'force': True, # Ensure append works
            'scroll_to_end': True
        })
    except Exception as e:
         print(f"{PLUGIN_NAME} Error appending status message to view {current_chat_view.id()}: {e}")
    finally:
        # Restore read-only state if it was True initially and view still valid
        if was_read_only and current_chat_view.is_valid():
            sublime.set_timeout(lambda: current_chat_view.set_read_only(True) if current_chat_view.is_valid() else None, 10)


# Removed claudette_estimate_api_tokens as token counting is API specific and removed for now

# --- Generic File Utilities (Keep or Rename) ---

# Renamed for consistency (optional)
def assistant_detect_encoding(sample: bytes) -> str:
    """
    Detect file encoding using common Byte Order Marks (BOMs) and fallback checks.
    Returns the detected encoding name (e.g., 'utf-8', 'utf-16le').
    """
    # Check for BOMs first (Byte Order Marks)
    # Most specific first (UTF-32)
    if sample.startswith(b'\xFF\xFE\x00\x00'): return 'utf-32le'
    if sample.startswith(b'\x00\x00\xFE\xFF'): return 'utf-32be'
    # Then UTF-16
    if sample.startswith(b'\xFF\xFE'): return 'utf-16le'
    if sample.startswith(b'\xFE\xFF'): return 'utf-16be'
    # Then UTF-8 BOM
    if sample.startswith(b'\xEF\xBB\xBF'): return 'utf-8-sig'

    # If no BOM, try decoding as UTF-8 (most common nowadays)
    try:
        sample.decode('utf-8')
        return 'utf-8' # Assume UTF-8 if decoding succeeds without errors
    except UnicodeDecodeError:
        # If UTF-8 fails, fallback to a common legacy encoding.
        # ISO-8859-1 (Latin-1) can decode almost any byte sequence, but might misinterpret characters.
        # Windows-1252 is common on Windows for older files.
        # For simplicity and broad compatibility, often fallback to 'latin-1' or 'cp1252'.
        # Let's default to latin-1 as a safe fallback guess.
        return 'latin-1'

# Renamed for consistency (optional)
def assistant_is_text_file(
        file_path: str,
        sample_size: int = 4096,
        max_size: int = 10 * 1024 * 1024, # Default 10MB limit
        null_byte_threshold: float = 0.02 # Allow up to 2% null bytes
    ) -> Tuple[bool, Optional[str], str]:
    """
    Checks if a file is likely a text file based on size, null bytes, and encoding detection.

    Args:
        file_path: Absolute path to the file.
        sample_size: Number of bytes to read from the beginning for checks.
        max_size: Maximum file size in bytes to consider.
        null_byte_threshold: Maximum allowed proportion of null bytes (0.0 to 1.0).

    Returns:
        tuple: (is_text: bool, detected_encoding: Union[str, None], reason: str)
               encoding is None if not considered a text file.
               reason explains the classification decision.
    """
    try:
        # 1. Check File Existence and Type
        if not os.path.exists(file_path):
             return False, None, "File not found"
        if not os.path.isfile(file_path):
             return False, None, "Path is not a regular file"

        # 2. Check File Size
        file_size = os.path.getsize(file_path)
        if file_size > max_size:
            # Format sizes for readability
            size_mb = file_size / (1024 * 1024)
            limit_mb = max_size / (1024 * 1024)
            return False, None, f"File size ({size_mb:.1f} MB) exceeds limit ({limit_mb:.0f} MB)"

        # 3. Handle Empty File (Considered text)
        if file_size == 0:
            return True, 'utf-8', "Empty file" # Treat empty files as UTF-8 text

        # 4. Read Sample Data
        read_size = min(sample_size, file_size)
        with open(file_path, 'rb') as f:
            sample = f.read(read_size)

        # 5. Check for Excessive NULL Bytes (common binary indicator)
        if b'\x00' in sample:
            null_count = sample.count(b'\x00')
            null_proportion = null_count / len(sample)
            if null_proportion > null_byte_threshold:
                return False, None, f"Binary file suspected ({null_proportion:.1%} NULL bytes in sample)"

        # 6. Detect Encoding (using the utility function)
        encoding = assistant_detect_encoding(sample)

        # 7. Verify by Attempting to Read with Detected Encoding (Optional but recommended)
        # This ensures the *whole* sample (or file) can be decoded reasonably.
        # We already decoded the sample in detect_encoding for UTF-8 check,
        # but this verifies BOM-detected encodings too.
        try:
            # Re-open and read a small amount with the detected encoding
            # Using 'errors=strict' will raise UnicodeDecodeError on failure
            with open(file_path, 'r', encoding=encoding, errors='strict') as f:
                f.read(min(read_size // 2, 1024)) # Read a small chunk to verify
            return True, encoding, f"Likely text file (Encoding: {encoding})"
        except (UnicodeDecodeError, LookupError) as decode_error:
             # LookupError for invalid encoding names (shouldn't happen with our detector)
             # UnicodeDecodeError means the file isn't consistently decodable with this encoding
             return False, None, f"Failed to decode consistently as {encoding} ({decode_error})"
        except Exception as verify_error:
             # Catch other potential errors during verification read
             print(f"{PLUGIN_NAME} Error verifying encoding for {file_path}: {verify_error}")
             return False, None, f"Error verifying file encoding ({verify_error})"

    except IOError as e:
        return False, None, f"IO Error reading file: {e.strerror}"
    except Exception as e:
        # Catch any other unexpected errors during the checks
        print(f"{PLUGIN_NAME} Unexpected error checking file type for {file_path}: {e}")
        return False, None, f"Unexpected error checking file: {e}"