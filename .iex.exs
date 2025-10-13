if Version.match?(System.version(), ">= 1.18.0") do
  IEx.configure(auto_reload: true)
end

IEx.configure(inspect: [base: :decimal, charlists: :as_lists, binaries: :as_binaries])
