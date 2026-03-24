using System.Net;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using SharedSpaces.Server.Infrastructure.Persistence;

namespace SharedSpaces.Server.Tests;

public class CorsConfigurationTests
{
    [Fact]
    public async Task SingleOrigin_AllowsConfiguredOrigin()
    {
        // Arrange
        var allowedOrigin = "https://example.com";
        await using var factory = new TestWebApplicationFactory(new[] { allowedOrigin });
        using var client = factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Get, "/v1/health");
        request.Headers.Add("Origin", allowedOrigin);

        // Act
        var response = await client.SendAsync(request);

        // Assert
        response.Headers.Should().ContainKey("Access-Control-Allow-Origin");
        response.Headers.GetValues("Access-Control-Allow-Origin").Should().Contain(allowedOrigin);
    }

    [Fact]
    public async Task MultipleOrigins_AllowsFirstConfiguredOrigin()
    {
        // Arrange
        var origin1 = "https://example.com";
        var origin2 = "https://app.example.com";
        var origin3 = "http://localhost:3000";
        await using var factory = new TestWebApplicationFactory(new[] { origin1, origin2, origin3 });
        using var client = factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Get, "/v1/health");
        request.Headers.Add("Origin", origin1);

        // Act
        var response = await client.SendAsync(request);

        // Assert
        response.Headers.Should().ContainKey("Access-Control-Allow-Origin");
        response.Headers.GetValues("Access-Control-Allow-Origin").Should().Contain(origin1);
    }

    [Fact]
    public async Task MultipleOrigins_AllowsSecondConfiguredOrigin()
    {
        // Arrange
        var origin1 = "https://example.com";
        var origin2 = "https://app.example.com";
        var origin3 = "http://localhost:3000";
        await using var factory = new TestWebApplicationFactory(new[] { origin1, origin2, origin3 });
        using var client = factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Get, "/v1/health");
        request.Headers.Add("Origin", origin2);

        // Act
        var response = await client.SendAsync(request);

        // Assert
        response.Headers.Should().ContainKey("Access-Control-Allow-Origin");
        response.Headers.GetValues("Access-Control-Allow-Origin").Should().Contain(origin2);
    }

    [Fact]
    public async Task MultipleOrigins_AllowsThirdConfiguredOrigin()
    {
        // Arrange
        var origin1 = "https://example.com";
        var origin2 = "https://app.example.com";
        var origin3 = "http://localhost:3000";
        await using var factory = new TestWebApplicationFactory(new[] { origin1, origin2, origin3 });
        using var client = factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Get, "/v1/health");
        request.Headers.Add("Origin", origin3);

        // Act
        var response = await client.SendAsync(request);

        // Assert
        response.Headers.Should().ContainKey("Access-Control-Allow-Origin");
        response.Headers.GetValues("Access-Control-Allow-Origin").Should().Contain(origin3);
    }

    [Fact]
    public async Task UnconfiguredOrigin_DoesNotReceiveCorsHeaders()
    {
        // Arrange
        var allowedOrigin = "https://example.com";
        var disallowedOrigin = "https://evil.com";
        await using var factory = new TestWebApplicationFactory(new[] { allowedOrigin });
        using var client = factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Get, "/v1/health");
        request.Headers.Add("Origin", disallowedOrigin);

        // Act
        var response = await client.SendAsync(request);

        // Assert
        // When origin is not allowed, the CORS middleware won't add CORS headers
        response.Headers.Should().NotContainKey("Access-Control-Allow-Origin");
    }

    [Fact]
    public async Task NoOriginsConfigured_FallsBackToDefaultOrigin()
    {
        // Arrange
        var defaultOrigin = "https://localhost:5173";
        await using var factory = new TestWebApplicationFactory(origins: null); // No origins configured
        using var client = factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Get, "/v1/health");
        request.Headers.Add("Origin", defaultOrigin);

        // Act
        var response = await client.SendAsync(request);

        // Assert
        response.Headers.Should().ContainKey("Access-Control-Allow-Origin");
        response.Headers.GetValues("Access-Control-Allow-Origin").Should().Contain(defaultOrigin);
    }

    [Fact]
    public async Task PreflightRequest_WithAllowedOrigin_ReturnsCorrectHeaders()
    {
        // Arrange
        var allowedOrigin = "https://example.com";
        await using var factory = new TestWebApplicationFactory(new[] { allowedOrigin });
        using var client = factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Options, "/v1/health");
        request.Headers.Add("Origin", allowedOrigin);
        request.Headers.Add("Access-Control-Request-Method", "POST");
        request.Headers.Add("Access-Control-Request-Headers", "content-type");

        // Act
        var response = await client.SendAsync(request);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        response.Headers.Should().ContainKey("Access-Control-Allow-Origin");
        response.Headers.GetValues("Access-Control-Allow-Origin").Should().Contain(allowedOrigin);
        response.Headers.Should().ContainKey("Access-Control-Allow-Methods");
        response.Headers.Should().ContainKey("Access-Control-Allow-Headers");
    }

    [Fact]
    public async Task PreflightRequest_WithDisallowedOrigin_DoesNotReceiveCorsHeaders()
    {
        // Arrange
        var allowedOrigin = "https://example.com";
        var disallowedOrigin = "https://evil.com";
        await using var factory = new TestWebApplicationFactory(new[] { allowedOrigin });
        using var client = factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Options, "/v1/health");
        request.Headers.Add("Origin", disallowedOrigin);
        request.Headers.Add("Access-Control-Request-Method", "POST");

        // Act
        var response = await client.SendAsync(request);

        // Assert
        response.Headers.Should().NotContainKey("Access-Control-Allow-Origin");
    }

    [Fact]
    public async Task CredentialsEnabled_HeaderPresent()
    {
        // Arrange
        var allowedOrigin = "https://example.com";
        await using var factory = new TestWebApplicationFactory(new[] { allowedOrigin });
        using var client = factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Get, "/v1/health");
        request.Headers.Add("Origin", allowedOrigin);

        // Act
        var response = await client.SendAsync(request);

        // Assert
        response.Headers.Should().ContainKey("Access-Control-Allow-Credentials");
        response.Headers.GetValues("Access-Control-Allow-Credentials").Should().Contain("true");
    }

    private sealed class TestWebApplicationFactory : WebApplicationFactory<Program>
    {
        private const string AdminSecret = "test-admin-secret";
        private const string JwtSigningKey = "test-signing-key-1234567890abcdef";
        private readonly string _databaseName = $"sharedspaces-cors-tests-{Guid.NewGuid()}";
        private readonly string[]? _origins;

        public TestWebApplicationFactory(string[]? origins)
        {
            _origins = origins;
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");

            builder.ConfigureAppConfiguration((_, configBuilder) =>
            {
                var config = new Dictionary<string, string?>
                {
                    ["Admin:Secret"] = AdminSecret,
                    ["Jwt:SigningKey"] = JwtSigningKey,
                    ["Storage:BasePath"] = "./artifacts/storage-tests"
                };

                // Add origins configuration if provided
                if (_origins != null)
                {
                    for (int i = 0; i < _origins.Length; i++)
                    {
                        config[$"Cors:Origins:{i}"] = _origins[i];
                    }
                }

                configBuilder.AddInMemoryCollection(config);
            });

            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<AppDbContext>>();
                services.RemoveAll<IDbContextOptionsConfiguration<AppDbContext>>();
                services.RemoveAll<AppDbContext>();

                services.AddDbContext<AppDbContext>(options => options.UseInMemoryDatabase(_databaseName));
            });
        }
    }
}
