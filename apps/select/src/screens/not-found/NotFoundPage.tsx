"use client";

import { useRouter } from "next/navigation";
import "./NotFoundPage.css";

const NotFoundPage = () => {
  const router = useRouter();

  const handleGoBack = () => {
    // middleware.ts bounces to "/" automatically if there's no valid session.
    router.push("/dashboard");
  };

  return (
    <div className="not-found-page">
      <div className="not-found-card">
        <span className="not-found-code">404</span>
        <h1>Page Not Found</h1>
        <p>The page you&apos;re looking for doesn&apos;t exist or may have moved.</p>
        <button onClick={handleGoBack}>Go Back</button>
      </div>
    </div>
  );
};

export default NotFoundPage;
