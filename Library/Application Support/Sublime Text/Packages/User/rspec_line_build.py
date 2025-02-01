import sublime
import sublime_plugin
import subprocess
import threading
import os

class RspecLineBuildCommand(sublime_plugin.WindowCommand):
    encoding = 'utf-8'
    killed = False
    proc = None
    panel = None
    panel_lock = threading.Lock()

    def is_enabled(self, kill=False):
        if kill:
            return self.proc is not None and self.proc.poll() is None
        return True

    def run(self, singleline=False, kill=False):
        if kill:
            if self.proc:
                self.killed = True
                self.proc.terminate()
            return

        view = self.window.active_view()
        if not view:
            return

        file_path = view.file_name()
        if not file_path or not file_path.endswith('_spec.rb'):
            sublime.status_message("Not a spec file")
            return

        vars = self.window.extract_variables()
        working_dir = vars['folder']

        with self.panel_lock:
            self.panel = self.window.create_output_panel('exec')

            # Set up error matching for navigation
            settings = self.panel.settings()
            settings.set(
                'result_file_regex',
                r'# ([A-Za-z:0-9_./ ]+rb):([0-9]+)'
            )
            settings.set('result_base_dir', working_dir)

            self.window.run_command('show_panel', {'panel': 'output.exec'})

        if self.proc is not None:
            self.proc.terminate()
            self.proc = None

        # Build the command
        cmd = f"source ~/.zshrc && "
        if singleline:
            current_row, _ = view.rowcol(view.sel()[0].begin())
            line_number = current_row + 1
            cmd += f"bin/rspec {file_path}:{line_number}"
        else:
            cmd += f"bin/rspec {file_path}"

        self.proc = subprocess.Popen(
            ['zsh', '-c', cmd],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            cwd=working_dir
        )
        self.killed = False

        threading.Thread(
            target=self.read_handle,
            args=(self.proc.stdout,)
        ).start()

    def read_handle(self, handle):
        chunk_size = 2 ** 13
        out = b''
        while True:
            try:
                data = os.read(handle.fileno(), chunk_size)
                out += data
                if len(data) == chunk_size:
                    continue
                if data == b'' and out == b'':
                    raise IOError('EOF')
                self.queue_write(out.decode(self.encoding))
                if data == b'':
                    raise IOError('EOF')
                out = b''
            except (UnicodeDecodeError) as e:
                msg = 'Error decoding output using %s - %s'
                self.queue_write(msg % (self.encoding, str(e)))
                break
            except (IOError):
                if self.killed:
                    msg = 'Cancelled'
                else:
                    msg = 'Finished'
                self.queue_write('\n[%s]' % msg)
                break

    def queue_write(self, text):
        sublime.set_timeout(lambda: self.do_write(text), 1)

    def do_write(self, text):
        with self.panel_lock:
            self.panel.run_command('append', {'characters': text})