import { Component } from "react";

// Keeps a render error on one page from blanking the whole app (navigation stays usable).
// Layout keys this by pathname, so moving to another page clears the error.
export default class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Page render error:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto max-w-lg p-8">
        <h1 className="text-xl font-semibold">This page hit an error</h1>
        <p className="mt-2 text-sm text-slate-600">Nothing was changed. Reload the page, or use the navigation to open another section.</p>
        <p className="mt-3 break-words text-xs text-slate-500">{String(this.state.error?.message || this.state.error)}</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-4 min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium">Reload page</button>
      </div>
    );
  }
}
