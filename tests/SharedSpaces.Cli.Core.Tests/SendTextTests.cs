using System.Net;
using SharedSpaces.Cli.Core.Services;

namespace SharedSpaces.Cli.Core.Tests;

public class SendTextTests
{
    private const string ServerUrl = "https://server.example.com";
    private const string SpaceId = "550e8400-e29b-41d4-a716-446655440000";
    private const string ItemId = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    private const string Token = "eyJ-token";

    private static string SuccessBody() => $$"""
        {
          "id": "{{ItemId}}",
          "spaceId": "{{SpaceId}}",
          "contentType": "text",
          "content": "Hello",
          "fileSize": 5,
          "sharedAt": "2026-01-01T00:00:00Z",
          "ttlSeconds": 3600
        }
        """;

    private static (SharedSpacesApiClient Client, CapturingHandler Handler) CreateClient(
        HttpStatusCode status = HttpStatusCode.Created,
        string? body = null)
    {
        var handler = new CapturingHandler(status, body ?? SuccessBody());
        return (new SharedSpacesApiClient(new HttpClient(handler)), handler);
    }

    [Fact]
    public async Task SendTextAsync_PutsToItemUrlWithBearerToken()
    {
        var (client, handler) = CreateClient();
        using var _ = client;

        await client.SendTextAsync(ServerUrl, SpaceId, ItemId, Token, "Hello");

        handler.Method.Should().Be(HttpMethod.Put);
        handler.Url.Should().Be($"{ServerUrl}/v1/spaces/{SpaceId}/items/{ItemId}");
        handler.AuthScheme.Should().Be("Bearer");
        handler.AuthParameter.Should().Be(Token);
    }

    [Fact]
    public async Task SendTextAsync_TrimsTrailingSlashFromServerUrl()
    {
        var (client, handler) = CreateClient();
        using var _ = client;

        await client.SendTextAsync($"{ServerUrl}/", SpaceId, ItemId, Token, "Hello");

        handler.Url.Should().Be($"{ServerUrl}/v1/spaces/{SpaceId}/items/{ItemId}");
    }

    [Fact]
    public async Task SendTextAsync_SendsTextContentTypeAndContent()
    {
        var (client, handler) = CreateClient();
        using var _ = client;

        await client.SendTextAsync(ServerUrl, SpaceId, ItemId, Token, "Build finished");

        handler.FormFields.Should().Contain(new KeyValuePair<string, string>("id", ItemId));
        handler.FormFields.Should().Contain(new KeyValuePair<string, string>("contentType", "text"));
        handler.FormFields.Should().Contain(new KeyValuePair<string, string>("content", "Build finished"));
    }

    [Fact]
    public async Task SendTextAsync_IncludesTtlWhenProvided()
    {
        var (client, handler) = CreateClient();
        using var _ = client;

        await client.SendTextAsync(ServerUrl, SpaceId, ItemId, Token, "Hello", ttlSeconds: 3600);

        handler.FormFields.Should().Contain(new KeyValuePair<string, string>("ttlSeconds", "3600"));
    }

    [Fact]
    public async Task SendTextAsync_OmitsTtlWhenNotProvided()
    {
        var (client, handler) = CreateClient();
        using var _ = client;

        await client.SendTextAsync(ServerUrl, SpaceId, ItemId, Token, "Hello");

        handler.FormFields.Should().NotContainKey("ttlSeconds");
    }

    [Fact]
    public async Task SendTextAsync_ReturnsParsedResponse()
    {
        var (client, _) = CreateClient();
        using var __ = client;

        var response = await client.SendTextAsync(ServerUrl, SpaceId, ItemId, Token, "Hello");

        response.Id.Should().Be(Guid.Parse(ItemId));
        response.ContentType.Should().Be("text");
        response.TtlSeconds.Should().Be(3600);
    }

    [Fact]
    public async Task SendTextAsync_ThrowsWithServerBodyOnFailure()
    {
        var (client, _) = CreateClient(HttpStatusCode.BadRequest, "{\"error\":\"ttlSeconds must be greater than 0\"}");
        using var __ = client;

        var act = async () => await client.SendTextAsync(ServerUrl, SpaceId, ItemId, Token, "Hello");

        (await act.Should().ThrowAsync<HttpRequestException>())
            .WithMessage("*Send failed (400*ttlSeconds must be greater than 0*");
    }

    [Fact]
    public async Task SendTextAsync_ThrowsWhenResponseBodyIsNull()
    {
        var (client, _) = CreateClient(HttpStatusCode.Created, "null");
        using var __ = client;

        var act = async () => await client.SendTextAsync(ServerUrl, SpaceId, ItemId, Token, "Hello");

        await act.Should().ThrowAsync<InvalidOperationException>();
    }

    private sealed class CapturingHandler : HttpMessageHandler
    {
        private readonly HttpStatusCode _status;
        private readonly string _body;

        public CapturingHandler(HttpStatusCode status, string body)
        {
            _status = status;
            _body = body;
        }

        public HttpMethod? Method { get; private set; }
        public string? Url { get; private set; }
        public string? AuthScheme { get; private set; }
        public string? AuthParameter { get; private set; }
        public Dictionary<string, string> FormFields { get; } = new();

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Method = request.Method;
            Url = request.RequestUri?.ToString();
            AuthScheme = request.Headers.Authorization?.Scheme;
            AuthParameter = request.Headers.Authorization?.Parameter;

            if (request.Content is MultipartFormDataContent multipart)
            {
                foreach (var part in multipart)
                {
                    var name = part.Headers.ContentDisposition?.Name?.Trim('"');
                    if (name is not null)
                    {
                        FormFields[name] = await part.ReadAsStringAsync(cancellationToken);
                    }
                }
            }

            return new HttpResponseMessage(_status)
            {
                Content = new StringContent(_body, System.Text.Encoding.UTF8, "application/json")
            };
        }
    }
}
