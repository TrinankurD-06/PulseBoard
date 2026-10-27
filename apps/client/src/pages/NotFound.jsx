import ErrorPage from '../components/ErrorPage.jsx';

/** 404 (and "workspace not found" / "monitor not found"): one layout, see ErrorPage. */
export default function NotFound({ message = "The page you're looking for doesn't exist." }) {
  return <ErrorPage code="404" title="Not found." message={message} />;
}
