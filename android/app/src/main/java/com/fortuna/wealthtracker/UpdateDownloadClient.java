package com.fortuna.wealthtracker;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.util.Arrays;
import java.util.Locale;

import javax.net.ssl.SSLException;

/** Connection retries always start at the verified release URL, never a cached CDN URL. */
final class UpdateDownloadClient {
    interface ConnectionFactory {
        HttpURLConnection open(URL url) throws IOException;
    }

    static final class DownloadException extends IOException {
        final String code;
        final boolean retryable;

        DownloadException(String code, String message, boolean retryable) {
            super(message);
            this.code = code;
            this.retryable = retryable;
        }
    }

    private UpdateDownloadClient() {}

    static HttpURLConnection open(URL initialUrl) throws IOException {
        return open(initialUrl, url -> (HttpURLConnection) url.openConnection());
    }

    static HttpURLConnection open(URL initialUrl, ConnectionFactory factory) throws IOException {
        for (int attempt = 0; attempt < 2; attempt += 1) {
            try {
                // GitHub returns short-lived signed CDN destinations. Ask for a fresh redirect.
                String separator = initialUrl.getQuery() == null ? "?" : "&";
                URL freshUrl = new URL(initialUrl.getProtocol(), initialUrl.getHost(), initialUrl.getPort(),
                    initialUrl.getFile() + separator + "fortuna_update=" + System.nanoTime());
                return openOnce(freshUrl, factory);
            } catch (IOException error) {
                if (attempt == 0 && isRetryable(error)) continue;
                if (error instanceof DownloadException) throw error;
                throw new DownloadException(failureCode(error), "Cannot connect to the update download server", false);
            }
        }
        throw new IOException("Update connection failed");
    }

    private static HttpURLConnection openOnce(URL initialUrl, ConnectionFactory factory) throws IOException {
        URL currentUrl = initialUrl;
        for (int redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
            if (!isTrustedDownloadHost(currentUrl)) {
                throw new DownloadException("UNTRUSTED_UPDATE_REDIRECT", "Update redirected to an untrusted host", false);
            }
            HttpURLConnection connection = factory.open(currentUrl);
            boolean keepOpen = false;
            try {
                connection.setInstanceFollowRedirects(false);
                connection.setUseCaches(false);
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(60_000);
                connection.setRequestProperty("Cache-Control", "no-cache");
                connection.setRequestProperty("Accept", "application/vnd.android.package-archive, application/octet-stream");
                connection.setRequestProperty("User-Agent", "Fortuna-Android-Updater");
                int status = connection.getResponseCode();
                if (status == HttpURLConnection.HTTP_OK) {
                    keepOpen = true;
                    return connection;
                }
                if (Arrays.asList(301, 302, 303, 307, 308).contains(status)) {
                    String location = connection.getHeaderField("Location");
                    if (location == null || location.isEmpty()) {
                        throw new DownloadException("INVALID_UPDATE_REDIRECT", "Update redirect is missing a destination", false);
                    }
                    currentUrl = new URL(currentUrl, location);
                    continue;
                }
                boolean expiredCdnUrl = status == 403 && !"github.com".equalsIgnoreCase(currentUrl.getHost());
                boolean transientFailure = status == 408 || status == 429 || status >= 500 || expiredCdnUrl;
                throw new DownloadException("UPDATE_HTTP_FAILED", "Update server returned HTTP " + status, transientFailure);
            } finally {
                if (!keepOpen) connection.disconnect();
            }
        }
        throw new DownloadException("TOO_MANY_UPDATE_REDIRECTS", "Too many update redirects", false);
    }

    private static boolean isRetryable(IOException error) {
        if (error instanceof DownloadException) return ((DownloadException) error).retryable;
        return !(error instanceof SSLException);
    }

    static String failureCode(Exception error) {
        if (error instanceof DownloadException) return ((DownloadException) error).code;
        if (error instanceof SocketTimeoutException) return "UPDATE_NETWORK_TIMEOUT";
        if (error instanceof SSLException) return "UPDATE_TLS_FAILED";
        return "UPDATE_NETWORK_UNAVAILABLE";
    }

    private static boolean isTrustedDownloadHost(URL url) {
        if (!"https".equalsIgnoreCase(url.getProtocol())) return false;
        String host = url.getHost().toLowerCase(Locale.ROOT);
        return "github.com".equals(host) || host.endsWith(".githubusercontent.com");
    }
}
