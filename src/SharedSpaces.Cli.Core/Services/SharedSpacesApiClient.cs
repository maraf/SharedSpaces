using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace SharedSpaces.Cli.Core.Services;

public sealed class SharedSpacesApiClient : IDisposable
{
    private readonly HttpClient _http;

    public SharedSpacesApiClient()
        : this(new HttpClient())
    {
    }

    public SharedSpacesApiClient(HttpClient httpClient)
    {
        _http = httpClient;
    }

    public async Task<TokenResponse> ExchangeTokenAsync(
        string serverUrl,
        string spaceId,
        string pin,
        string displayName,
        CancellationToken ct = default)
    {
        var url = $"{serverUrl.TrimEnd('/')}/v1/spaces/{spaceId}/tokens";
        var request = new CreateTokenRequest(pin, displayName);

        using var response = await _http.PostAsJsonAsync(url, request, ct);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException(
                $"Token exchange failed ({(int)response.StatusCode} {response.ReasonPhrase}): {body}");
        }

        return await response.Content.ReadFromJsonAsync<TokenResponse>(ct)
            ?? throw new InvalidOperationException("Server returned empty token response.");
    }

    public async Task<UploadResponse> UploadFileAsync(
        string serverUrl,
        string spaceId,
        string itemId,
        string jwtToken,
        string filePath,
        CancellationToken ct = default)
    {
        var url = $"{serverUrl.TrimEnd('/')}/v1/spaces/{spaceId}/items/{itemId}";

        using var content = new MultipartFormDataContent();
        content.Add(new StringContent(itemId), "id");
        content.Add(new StringContent("file"), "contentType");

        var fileStream = File.OpenRead(filePath);
        var fileContent = new StreamContent(fileStream);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        content.Add(fileContent, "file", Path.GetFileName(filePath));

        using var request = new HttpRequestMessage(HttpMethod.Put, url) { Content = content };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", jwtToken);

        using var response = await _http.SendAsync(request, ct);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException(
                $"Upload failed ({(int)response.StatusCode} {response.ReasonPhrase}): {body}");
        }

        return await response.Content.ReadFromJsonAsync<UploadResponse>(ct)
            ?? throw new InvalidOperationException("Server returned empty upload response.");
    }

    public void Dispose() => _http.Dispose();
}

public sealed record CreateTokenRequest(
    [property: JsonPropertyName("pin")] string Pin,
    [property: JsonPropertyName("displayName")] string DisplayName);

public sealed record TokenResponse(
    [property: JsonPropertyName("token")] string Token);

public sealed record UploadResponse(
    [property: JsonPropertyName("id")] Guid Id,
    [property: JsonPropertyName("spaceId")] Guid SpaceId,
    [property: JsonPropertyName("contentType")] string ContentType,
    [property: JsonPropertyName("content")] string Content,
    [property: JsonPropertyName("fileSize")] long FileSize,
    [property: JsonPropertyName("sharedAt")] DateTime SharedAt);
