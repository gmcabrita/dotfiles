import sublime
import sublime_plugin
import os
import fnmatch # For wildcard matching in gitignore
from pathlib import Path
from .file_handler import GeminiAssistantFileHandler # Renamed import
from ..utils import gemini_assistant_chat_status_message # Renamed import
from ..constants import PLUGIN_NAME
from typing import List, Set, Optional, Dict, Any, Union

# Renamed Gitignore Parser (or keep generic name if preferred)
class GeminiAssistantGitignoreParser:
    """Parses .gitignore files and checks if paths should be ignored."""
    def __init__(self, root_path: str):
        try:
            self.root_path = Path(root_path).resolve() # Store absolute path
        except Exception as e:
             print(f"{PLUGIN_NAME} Error resolving root path '{root_path}': {e}")
             self.root_path = Path(root_path) # Fallback to original

        self.ignore_patterns: Set[str] = {
            '.git/',           # Always ignore .git directory contents
            '.gitignore',      # Always ignore .gitignore files themselves
            '.git',            # Match .git folder itself
            # Add other common ignores? e.g., node_modules/, __pycache__/
        }
        self.load_all_gitignores()

    def load_all_gitignores(self):
        """Load patterns from .gitignore files in root_path and its ancestors."""
        try:
            current_dir = self.root_path
            # Traverse up towards the root directory
            while current_dir.parent != current_dir: # Stop at filesystem root
                gitignore_path = current_dir / '.gitignore'
                if gitignore_path.is_file():
                    try:
                        with open(gitignore_path, 'r', encoding='utf-8', errors='ignore') as f:
                            for line in f:
                                stripped_line = line.strip()
                                # Ignore comments and empty lines
                                if stripped_line and not stripped_line.startswith('#'):
                                    self.ignore_patterns.add(stripped_line)
                    except IOError as e:
                         print(f"{PLUGIN_NAME} Warning: Could not read .gitignore '{gitignore_path}': {e}")
                    except Exception as e:
                         print(f"{PLUGIN_NAME} Error processing .gitignore '{gitignore_path}': {e}")

                # Move to the parent directory
                current_dir = current_dir.parent
        except Exception as e:
             print(f"{PLUGIN_NAME} Error loading .gitignore files: {e}")

    def _matches_pattern(self, relative_path_str: str, pattern: str) -> bool:
        """Checks if a relative path string matches a gitignore pattern."""
        # Normalize path separators for consistent matching
        relative_path_norm = relative_path_str.replace(os.sep, '/')
        pattern_norm = pattern.replace(os.sep, '/')

        # Handle different pattern types:
        # https://git-scm.com/docs/gitignore

        # 1. Trailing slash indicates directory match
        if pattern_norm.endswith('/'):
            # Match if path is a directory OR if path starts with the directory pattern
            # Need to know if relative_path_str represents a directory.
            # Simplification: Match if the path *string* starts with the pattern string
            # This works for paths like "dir/file" matching "dir/"
             pattern_dir = pattern_norm[:-1] # Remove trailing slash for comparison
             # Check if path is exactly the directory name or inside the directory
             return relative_path_norm == pattern_dir or relative_path_norm.startswith(pattern_dir + '/')


        # 2. Leading slash indicates root-relative match
        elif pattern_norm.startswith('/'):
             # Match only from the root directory
             pattern_root = pattern_norm[1:]
             # fnmatch works well here for root-level matching with potential wildcards
             return fnmatch.fnmatchcase(relative_path_norm, pattern_root)

        # 3. Patterns without slashes (or with internal slashes)
        else:
             # Match filename anywhere in the tree OR match path segment
             # fnmatch checks the full path against the pattern
             if fnmatch.fnmatchcase(relative_path_norm, pattern_norm):
                  return True
             # Also check if any *part* of the path matches the pattern (e.g., *.log)
             # This is complex; fnmatch on the full path handles many cases.
             # A simpler check: match against the basename
             basename = os.path.basename(relative_path_norm)
             if fnmatch.fnmatchcase(basename, pattern_norm):
                  return True

             # If pattern contains slashes, it should match the full path structure
             # fnmatch already handles this.

        return False


    def should_ignore(self, absolute_path_str: str) -> bool:
        """
        Checks if an absolute file path should be ignored based on loaded patterns.

        Args:
            absolute_path_str: The absolute path to the file or directory.

        Returns:
            True if the path should be ignored, False otherwise.
        """
        try:
            absolute_path = Path(absolute_path_str).resolve()
            # Calculate path relative to the gitignore root
            relative_path = absolute_path.relative_to(self.root_path)
            relative_path_str = str(relative_path) # Use string representation for matching

            # Check if the path itself or any parent directory matches ignore patterns
            current_relative_path = Path(relative_path_str)
            path_components = [str(current_relative_path)] # Check full relative path first
            # Add parent directories relative to root_path
            while current_relative_path.parent != Path('.'):
                 current_relative_path = current_relative_path.parent
                 path_components.append(str(current_relative_path))

            # Test the path and its parents against all patterns
            for pattern in self.ignore_patterns:
                # Check if the pattern negates a previous match (starts with !)
                is_negation = pattern.startswith('!')
                actual_pattern = pattern[1:] if is_negation else pattern

                # Check all relevant path strings (full path, parent dirs)
                for path_str_to_check in path_components:
                     if self._matches_pattern(path_str_to_check, actual_pattern):
                         # If it's a negation pattern, it overrides previous ignores *for this level*
                         # Gitignore logic is complex: later patterns override earlier ones.
                         # Our simple set doesn't preserve order.
                         # For simplicity: if *any* non-negated pattern matches, ignore.
                         # Negation handling would require ordered pattern processing.
                         if not is_negation:
                              # print(f"Ignoring '{relative_path_str}' due to pattern '{pattern}'")
                              return True
                         # else: A negation matched, but we don't handle overriding ignores yet.

            # Check for .git components explicitly (safer than relying on patterns sometimes)
            if '.git' in absolute_path.parts:
                 # print(f"Ignoring '{relative_path_str}' because it's inside .git")
                 return True


            # If no ignore pattern matched
            return False

        except ValueError:
            # Path is not inside the root_path, cannot determine using this parser
            # print(f"Path '{absolute_path_str}' is not relative to root '{self.root_path}', not ignoring based on this parser.")
            return False # Don't ignore if outside the context root
        except Exception as e:
             print(f"{PLUGIN_NAME} Error checking ignore status for '{absolute_path_str}': {e}")
             return False # Default to not ignoring on error


# Renamed command
class GeminiAssistantContextAddFilesCommand(sublime_plugin.WindowCommand):
    """Adds selected files/folders from sidebar or paths arg to the active chat context."""
    def run(self, paths: Optional[List[str]] = None, group: int = -1, index: int = -1):
        """
        Processes the provided paths (from sidebar args or direct call).

        Args:
            paths (list, optional): List of absolute paths to process.
            group (int, optional): Sidebar group index (unused).
            index (int, optional): Sidebar item index (unused).
        """
        if not paths:
            # This can happen if command is invoked without args (e.g., from palette)
            sublime.status_message("No files or folders specified to add.")
            return

        # --- Find Active Chat View ---
        chat_view = self.find_active_chat_view()
        if not chat_view:
            # Attempt to create one? Or just show error?
            # Let's show an error and guide the user.
            sublime.error_message(f"{PLUGIN_NAME}: No active chat view found.\nPlease open or start a chat first.")
            return

        # --- Initialize File Handler ---
        # Get existing context or start fresh
        # Use renamed setting key
        existing_context = chat_view.settings().get('gemini_assistant_context_files', {})
        if not isinstance(existing_context, dict): # Validate setting type
             print(f"{PLUGIN_NAME} Warning: Context files setting is not a dictionary. Resetting.")
             existing_context = {}

        file_handler = GeminiAssistantFileHandler()
        file_handler.files = existing_context # Load existing context into handler


        # --- Process Paths ---
        # Determine the common root for gitignore lookup (can be slow if many diverse paths)
        # Simplification: Use the first path's directory or the path itself if it's a dir.
        # More robust: Find common ancestor if multiple top-level paths.
        root_for_gitignore = os.getcwd() # Default fallback
        if paths:
            first_path = paths[0]
            if os.path.isdir(first_path):
                 root_for_gitignore = first_path
            elif os.path.isfile(first_path):
                 root_for_gitignore = os.path.dirname(first_path)
            else: # Path doesn't exist?
                 pass # Keep default cwd

        gitignore = GeminiAssistantGitignoreParser(root_for_gitignore)

        processed_files_count = 0
        ignored_files_count = 0
        added_files_paths: List[str] = [] # Track relative paths added/updated

        for path_arg in paths:
            absolute_path = os.path.abspath(path_arg)

            if not os.path.exists(absolute_path):
                 print(f"{PLUGIN_NAME} Warning: Path does not exist, skipping: {absolute_path}")
                 continue

            if os.path.isdir(absolute_path):
                # Walk the directory
                for root, dirs, files in os.walk(absolute_path, topdown=True):
                    # Filter ignored directories *before* recursing into them
                    # Important: Modify dirs list *in place*
                    dirs[:] = [d for d in dirs if not gitignore.should_ignore(os.path.join(root, d))]

                    for file in files:
                        full_file_path = os.path.join(root, file)
                        if not gitignore.should_ignore(full_file_path):
                            # Process file using the handler
                            relative_path = file_handler.process_single_file(full_file_path, root_for_gitignore)
                            if relative_path: # If successfully processed (not binary etc.)
                                 processed_files_count += 1
                                 added_files_paths.append(relative_path)
                            # else: file skipped by handler (e.g., binary), count handled there?
                        else:
                            ignored_files_count += 1
            elif os.path.isfile(absolute_path):
                # Process a single file
                if not gitignore.should_ignore(absolute_path):
                     relative_path = file_handler.process_single_file(absolute_path, root_for_gitignore)
                     if relative_path:
                          processed_files_count += 1
                          added_files_paths.append(relative_path)
                     # else: file skipped by handler
                else:
                    ignored_files_count += 1
            else:
                 print(f"{PLUGIN_NAME} Warning: Path is not a file or directory, skipping: {absolute_path}")


        # --- Update Chat View Settings ---
        # The file_handler.files dictionary now contains the updated context
        chat_view.settings().set('gemini_assistant_context_files', file_handler.files)

        # --- Provide Feedback ---
        total_in_context = len(file_handler.files)
        # Use added_files_paths to report what was just added/updated
        added_count = len(set(added_files_paths)) # Count unique relative paths processed

        message_parts = []
        if added_count > 0:
             message_parts.append(f"Added/updated {added_count} file{'s' if added_count != 1 else ''}")
        if ignored_files_count > 0:
             message_parts.append(f"ignored {ignored_files_count} file{'s' if ignored_files_count != 1 else ''} (gitignore)")

        final_message = ", ".join(message_parts)
        if not final_message:
             final_message = "No new files added or updated."
        else:
             final_message += f". Total files in context: {total_in_context}."


        gemini_assistant_chat_status_message(self.window, final_message, "✅")
        sublime.status_message(final_message) # Also show briefly in status bar


    def find_active_chat_view(self) -> Union[sublime.View, None]:
        """Helper to find the currently active chat view in the window."""
        # Duplicated again, ideal candidate for a shared utility function
        for view in self.window.views():
            # Use renamed settings keys
            if (view.settings().get('gemini_assistant_is_chat_view', False) and
                view.settings().get('gemini_assistant_is_current_chat', False)):
                return view
        # Fallback: Return the first chat view found if none is marked as current
        for view in self.window.views():
             if view.settings().get('gemini_assistant_is_chat_view', False):
                  return view
        return None

    # --- Sidebar Context Menu Visibility/Enabling ---

    def is_visible(self, paths: Optional[List[str]] = None, group: int = -1, index: int = -1):
        """Show in sidebar only if paths are provided."""
        return bool(paths) # Only visible when invoked with paths (i.e., from sidebar)

    def is_enabled(self, paths: Optional[List[str]] = None, group: int = -1, index: int = -1):
        """Enable in sidebar if paths are provided AND a chat view exists."""
        if not paths: return False
        # Check if a chat view exists to add context to
        return bool(self.find_active_chat_view())

    def description(self, paths: Optional[List[str]] = None, group: int = -1, index: int = -1):
         """Provide dynamic description for the command in menus."""
         if not paths:
             return "Include in Context" # Default if no paths somehow

         count = len(paths)
         item_type = "folder" if count == 1 and os.path.isdir(paths[0]) else "item"
         plural = 's' if count != 1 else ''
         return f"Include {count} {item_type}{plural} in Gemini Context"


    def want_event(self):
         """Required for commands accepting drag-and-drop events (optional)."""
         return False # Not needed for standard sidebar interaction