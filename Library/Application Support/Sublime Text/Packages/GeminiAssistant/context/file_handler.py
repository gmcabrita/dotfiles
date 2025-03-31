import os
import sublime # Needed for sublime.error_message maybe?
from ..utils import assistant_is_text_file # Use renamed utility
from ..constants import PLUGIN_NAME
from typing import List, Dict, Any, Optional

class GeminiAssistantFileHandler:
    """Handles reading and processing files for the chat context."""
    def __init__(self):
        # Stores context: { 'relative/path/to/file.py': {'content': '...', 'absolute_path': '...', 'api_tokens': ...}, ... }
        self.files: Dict[str, Dict[str, Any]] = {}
        self.processed_files_count = 0
        self.skipped_files_count = 0

    def _estimate_tokens(self, text: str) -> int:
        """
        Roughly estimate token count for text.
        Google's tokenization differs from others. A simple char/word count is a proxy.
        Using 1 token ~= 4 chars is a common rule of thumb.
        """
        if not text: return 0
        # Simple approximation: characters / 4
        return len(text) // 4

    def process_single_file(self, absolute_path: str, context_root: str) -> Optional[str]:
        """
        Processes a single file: checks if text, reads content, calculates relative path.
        Updates self.files dictionary.

        Args:
            absolute_path: The absolute path to the file.
            context_root: The root directory used for calculating the relative path key.

        Returns:
            The relative path key if the file was successfully processed and added/updated,
            None otherwise (e.g., if binary, unreadable, or skipped).
        """
        try:
            # 1. Check if it's a text file we should process
            is_text, encoding, reason = assistant_is_text_file(absolute_path)
            if not is_text:
                # print(f"{PLUGIN_NAME} Skipping non-text file ({reason}): {absolute_path}")
                self.skipped_files_count += 1
                return None

            # 2. Calculate relative path to use as the dictionary key
            try:
                # Ensure context_root is absolute for correct relative path calculation
                abs_context_root = os.path.abspath(context_root)
                relative_path = os.path.relpath(absolute_path, abs_context_root)
                # Normalize path separators for consistency across OS
                relative_path = relative_path.replace(os.sep, '/')
            except ValueError as e:
                 print(f"{PLUGIN_NAME} Error calculating relative path for '{absolute_path}' against root '{context_root}': {e}")
                 # Fallback: use basename? Or skip? Let's skip.
                 self.skipped_files_count += 1
                 return None

            # 3. Read file content
            file_content = ''
            try:
                # Use the detected encoding (or default if detection failed but was deemed text)
                read_encoding = encoding if encoding else 'utf-8'
                with open(absolute_path, 'r', encoding=read_encoding, errors='replace') as f:
                    file_content = f.read()
            except IOError as e:
                 print(f"{PLUGIN_NAME} Error reading file '{absolute_path}': {e.strerror}")
                 self.skipped_files_count += 1
                 # If we can't read it, remove it if it was already in context?
                 if relative_path in self.files: del self.files[relative_path]
                 return None
            except Exception as e:
                 print(f"{PLUGIN_NAME} Unexpected error reading file '{absolute_path}': {e}")
                 self.skipped_files_count += 1
                 if relative_path in self.files: del self.files[relative_path]
                 return None


            # 4. Estimate tokens (optional, for display or limits)
            estimated_tokens = self._estimate_tokens(file_content)

            # 5. Update the files dictionary
            # Use a consistent structure for the value
            self.files[relative_path] = {
                'content': file_content,
                'api_tokens': estimated_tokens, # Store estimated tokens
                'absolute_path': absolute_path # Store absolute path for opening/refreshing
            }
            self.processed_files_count += 1 # Count successful processing
            # print(f"{PLUGIN_NAME} Added/Updated context: {relative_path} ({estimated_tokens} tokens)")
            return relative_path # Return the key used

        except Exception as e:
            print(f"{PLUGIN_NAME} Error processing file '{absolute_path}': {str(e)}")
            self.skipped_files_count += 1
            # Attempt to remove from context if error occurs during processing
            # relative_path_error_case = os.path.relpath(absolute_path, context_root).replace(os.sep, '/') # Recalculate or pass?
            # if relative_path_error_case in self.files: del self.files[relative_path_error_case]
            return None

    def process_paths_list(self, paths: List[str]) -> Dict[str, Any]:
        """
        Processes a list of file or directory paths, updating the internal context.
        Deprecated in favor of processing within the command? Or keep as utility?
        Keeping it for now, but ensure `context_root` logic is sound.
        """
        self.processed_files_count = 0 # Reset counters for this run
        self.skipped_files_count = 0

        if not paths:
             return {'files': self.files, 'processed': 0, 'skipped': 0}

        # Determine a sensible context root for relative paths
        # If all paths share a common directory prefix, use that. Otherwise, maybe CWD?
        try:
            # Find common path requires converting all to absolute first
            abs_paths = [os.path.abspath(p) for p in paths]
            common_root = os.path.commonpath(abs_paths)
            # Ensure common_root is actually a directory, otherwise use its parent
            if not os.path.isdir(common_root):
                 common_root = os.path.dirname(common_root)
        except ValueError: # paths might be on different drives (Windows)
             common_root = os.getcwd() # Fallback to current working directory
        except Exception as e:
             print(f"{PLUGIN_NAME} Error finding common path: {e}. Using CWD as context root.")
             common_root = os.getcwd()


        for path in paths:
            abs_path = os.path.abspath(path)
            if os.path.isfile(abs_path):
                self.process_single_file(abs_path, common_root)
            elif os.path.isdir(abs_path):
                # Walk the directory (respecting gitignore would happen *before* this)
                for root, _, files in os.walk(abs_path):
                    for file in files:
                        file_path = os.path.join(root, file)
                        # Note: gitignore check should ideally happen here or in the calling command
                        self.process_single_file(file_path, common_root)
            # else: path doesn't exist or is not file/dir (ignore)

        return {
            'files': self.files, # Return the updated dictionary
            'processed': self.processed_files_count,
            'skipped': self.skipped_files_count
        }