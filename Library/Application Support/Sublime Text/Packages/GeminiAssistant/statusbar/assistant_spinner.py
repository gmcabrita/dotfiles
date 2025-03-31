import sublime
import time
from ..constants import PLUGIN_NAME # Optional: for logging

# Renamed class
class AssistantSpinner:
    """Handles displaying an animated spinner in the Sublime Text status bar."""
    def __init__(self):
        """Initialize the spinner with default values."""
        self.spinner_chars = ["●○○", "○●○", "○○●", "○●○"] # Example spinner frames
        # self.spinner_chars = ["[   ]", "[.  ]", "[.. ]", "[...]"] # Alternative style
        self.current_index = 0
        self.active = False
        self.message = ""
        self._timer = None # Internal timer object using sublime.set_timeout_async
        self.start_time = None
        self.duration = None # Optional duration in ms

    def start(self, message: str, duration: int = None):
        """
        Start displaying the spinner with a given message.

        Args:
            message (str): The base message to display.
            duration (int, optional): Duration in milliseconds after which
                                       the spinner should stop automatically.
        """
        # If already active with the same message, don't restart unless duration changes
        if self.active and self.message == message and self.duration == duration:
            return

        # Stop existing timer if running
        self._cancel_timer()

        self.message = message
        self.active = True
        self.current_index = 0  # Reset animation frame
        self.start_time = time.monotonic() # Use monotonic clock for duration
        self.duration = duration

        # Start the animation loop immediately
        self._update_spinner_display() # Initial display
        self._schedule_next_update() # Schedule next frame

    def stop(self):
        """Stop the spinner animation and clear the status bar message."""
        if not self.active:
            return # Already stopped

        self.active = False
        self._cancel_timer()

        # Clear the status message after a short delay to ensure it's cleared
        sublime.set_timeout(lambda: sublime.status_message(""), 10)

        # Reset state variables
        self.message = ""
        self.current_index = 0
        self.start_time = None
        self.duration = None

    def _schedule_next_update(self):
        """Schedules the next spinner frame update."""
        if not self.active: return
        # Schedule using set_timeout_async for background operation
        self._timer = sublime.set_timeout_async(self._run_update_cycle, 150) # Update interval (ms)

    def _run_update_cycle(self):
         """The function executed by the timer to update the spinner."""
         if not self.active: return # Stop if deactivated

         # Check duration if set
         if self.duration is not None:
             elapsed_time = (time.monotonic() - self.start_time) * 1000 # ms
             if elapsed_time >= self.duration:
                 self.stop() # Stop if duration exceeded
                 return

         # Update the display
         self._update_spinner_display()

         # Schedule the *next* update cycle
         self._schedule_next_update()


    def _update_spinner_display(self):
        """Updates the status bar with the current spinner frame."""
        if not self.active: return # Should not happen if timer is cancelled properly

        # Get the current spinner frame
        spinner_frame = self.spinner_chars[self.current_index]
        # Cycle to the next frame index
        self.current_index = (self.current_index + 1) % len(self.spinner_chars)
        # Format the status message
        status_text = f"{self.message} {spinner_frame}"

        # Update status bar (must run on main thread)
        sublime.set_timeout(lambda: sublime.status_message(status_text), 0)


    def _cancel_timer(self):
        """Cancels the pending timer."""
        # Note: sublime.set_timeout_async doesn't directly return a cancellable object easily.
        # Relying on the self.active flag is the primary way to stop the cycle.
        # This method is more conceptual unless a different timer mechanism is used.
        if self._timer is not None:
             # If _timer held an object with a cancel method (like threading.Timer), call it.
             # Since set_timeout_async doesn't provide one, this is mostly a placeholder.
             # The active flag check in _run_update_cycle prevents further scheduling.
             # print(f"{PLUGIN_NAME} Debug: Cancelling spinner timer (conceptual).")
             self._timer = None # Clear the reference

    def __del__(self):
         """Ensure spinner stops if the object is garbage collected."""
         self.stop()