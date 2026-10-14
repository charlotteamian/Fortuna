package com.fortuna.wealthtracker;

import org.junit.Test;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.List;

import javax.net.ssl.SSLHandshakeException;

import static org.junit.Assert.*;

public class UpdateDownloadClientTest {
    private static URL initialUrl() throws Exception {
        return new URL("https://github.com/charlotteamian/Fortuna/releases/download/v1.8.1/Fortuna-1.8.1-release.apk");
    }

    private static final class Response extends HttpURLConnection {
        final int status;
        final String location;
        final IOException failure;
        boolean disconnected;

        Response(URL url, int status, String location, IOException failure) {
            super(url);
            this.status = status;
            this.location = location;
            this.failure = failure;
        }

        @Override public int getResponseCode() throws IOException {
            if (failure != null) throw failure;
            return status;
        }
        @Override public String getHeaderField(String name) { return "Location".equals(name) ? location : null; }
        @Override public void disconnect() { disconnected = true; }
        @Override public boolean usingProxy() { return false; }
        @Override public void connect() {}
    }

    @Test
    public void followsLiveGithubCdnShapeWithoutCachingOrAutomaticRedirects() throws Exception {
        List<Response> responses = new ArrayList<>();
        HttpURLConnection result = UpdateDownloadClient.open(initialUrl(), url -> {
            Response response = new Response(url, responses.isEmpty() ? 302 : 200,
                "https://release-assets.githubusercontent.com/github-production-release-asset/asset.apk?signature=fixture", null);
            responses.add(response);
            return response;
        });
        assertEquals(2, responses.size());
        assertTrue(responses.get(0).disconnected);
        assertFalse(responses.get(1).disconnected);
        assertSame(responses.get(1), result);
        assertTrue(responses.get(0).getURL().getQuery().startsWith("fortuna_update="));
        for (Response response : responses) {
            assertFalse(response.getInstanceFollowRedirects());
            assertFalse(response.getUseCaches());
            assertEquals("no-cache", response.getRequestProperty("Cache-Control"));
        }
    }

    @Test
    public void retriesTimeoutFromFreshReleaseUrlAndClosesFailedConnection() throws Exception {
        List<Response> responses = new ArrayList<>();
        UpdateDownloadClient.open(initialUrl(), url -> {
            Response response = new Response(url, 200, null, responses.isEmpty() ? new SocketTimeoutException() : null);
            responses.add(response);
            return response;
        });
        assertEquals(2, responses.size());
        assertTrue(responses.get(0).disconnected);
        assertEquals(initialUrl().getPath(), responses.get(1).getURL().getPath());
        assertNotEquals(responses.get(0).getURL().getQuery(), responses.get(1).getURL().getQuery());
    }

    @Test
    public void reportsTimeoutAfterBoundedRetry() throws Exception {
        int[] attempts = {0};
        UpdateDownloadClient.DownloadException error = assertThrows(UpdateDownloadClient.DownloadException.class,
            () -> UpdateDownloadClient.open(initialUrl(), url -> {
                attempts[0] += 1;
                return new Response(url, 200, null, new SocketTimeoutException());
            }));
        assertEquals(2, attempts[0]);
        assertEquals("UPDATE_NETWORK_TIMEOUT", error.code);
    }

    @Test
    public void reportsUnreachableHostSeparatelyFromSecurityFailure() throws Exception {
        int[] attempts = {0};
        UpdateDownloadClient.DownloadException error = assertThrows(UpdateDownloadClient.DownloadException.class,
            () -> UpdateDownloadClient.open(initialUrl(), url -> {
                attempts[0] += 1;
                throw new UnknownHostException();
            }));
        assertEquals(2, attempts[0]);
        assertEquals("UPDATE_NETWORK_UNAVAILABLE", error.code);
    }

    @Test
    public void refreshesExpiredSignedCdnDestinationThroughGithub() throws Exception {
        List<Response> responses = new ArrayList<>();
        UpdateDownloadClient.open(initialUrl(), url -> {
            int hop = responses.size();
            Response response = new Response(url, hop == 0 || hop == 2 ? 302 : hop == 1 ? 403 : 200,
                "https://release-assets.githubusercontent.com/asset.apk?signature=" + hop, null);
            responses.add(response);
            return response;
        });
        assertEquals(4, responses.size());
        assertEquals("github.com", responses.get(2).getURL().getHost());
        assertTrue(responses.get(1).disconnected);
        assertNotEquals(responses.get(0).getURL().getQuery(), responses.get(2).getURL().getQuery());
    }

    @Test
    public void neverRetriesOrOpensUntrustedOrHttpRedirects() throws Exception {
        for (String destination : new String[]{"https://example.com/update.apk", "http://release-assets.githubusercontent.com/update.apk"}) {
            List<Response> responses = new ArrayList<>();
            UpdateDownloadClient.DownloadException error = assertThrows(UpdateDownloadClient.DownloadException.class,
                () -> UpdateDownloadClient.open(initialUrl(), url -> {
                    Response response = new Response(url, 302, destination, null);
                    responses.add(response);
                    return response;
                }));
            assertEquals("UNTRUSTED_UPDATE_REDIRECT", error.code);
            assertEquals(1, responses.size());
            assertTrue(responses.get(0).disconnected);
        }
    }

    @Test
    public void preservesTlsValidationWithoutRetryingCertificateFailures() throws Exception {
        int[] attempts = {0};
        UpdateDownloadClient.DownloadException error = assertThrows(UpdateDownloadClient.DownloadException.class,
            () -> UpdateDownloadClient.open(initialUrl(), url -> {
                attempts[0] += 1;
                return new Response(url, 200, null, new SSLHandshakeException("fixture certificate failure"));
            }));
        assertEquals(1, attempts[0]);
        assertEquals("UPDATE_TLS_FAILED", error.code);
    }

    @Test
    public void doesNotRetryMissingAssetOrMalformedRedirectResponse() throws Exception {
        for (int status : new int[]{404, 302}) {
            int[] attempts = {0};
            UpdateDownloadClient.DownloadException error = assertThrows(UpdateDownloadClient.DownloadException.class,
                () -> UpdateDownloadClient.open(initialUrl(), url -> {
                    attempts[0] += 1;
                    return new Response(url, status, null, null);
                }));
            assertEquals(1, attempts[0]);
            assertEquals(status == 404 ? "UPDATE_HTTP_FAILED" : "INVALID_UPDATE_REDIRECT", error.code);
        }
    }
}
