using FluentAssertions;
using SharedSpaces.Server.Infrastructure;

namespace SharedSpaces.Server.Tests;

public class CorsOriginMatcherTests
{
    [Theory]
    [InlineData("https://example.com", "https://example.com", true)]
    [InlineData("https://example.com", "https://other.com", false)]
    [InlineData("https://Example.COM", "https://example.com", true)]
    public void ExactMatch_ComparesOrdinalIgnoreCase(string origin, string pattern, bool expected) =>
        CorsOriginMatcher.IsWildcardMatch(origin, pattern).Should().Be(expected);

    [Theory]
    [InlineData("https://pr-42.azurewebapps.net", "https://pr-*.azurewebapps.net", true)]
    [InlineData("https://pr-123.azurewebapps.net", "https://pr-*.azurewebapps.net", true)]
    [InlineData("https://pr-.azurewebapps.net", "https://pr-*.azurewebapps.net", true)]
    [InlineData("https://evil.com", "https://pr-*.azurewebapps.net", false)]
    [InlineData("https://pr-42.evil.com", "https://pr-*.azurewebapps.net", false)]
    public void SingleWildcard_MatchesAnySubstring(string origin, string pattern, bool expected) =>
        CorsOriginMatcher.IsWildcardMatch(origin, pattern).Should().Be(expected);

    [Theory]
    [InlineData("https://a-x-b-y-c.com", "https://a-*-b-*-c.com", true)]
    [InlineData("https://a--b--c.com", "https://a-*-b-*-c.com", true)]
    [InlineData("https://a-x-c.com", "https://a-*-b-*-c.com", false)]
    public void MultipleWildcards_MatchSegmentsInOrder(string origin, string pattern, bool expected) =>
        CorsOriginMatcher.IsWildcardMatch(origin, pattern).Should().Be(expected);

    [Theory]
    [InlineData("https://anything.example.com", "https://*.example.com", true)]
    [InlineData("https://example.com", "https://*.example.com", false)]
    public void LeadingWildcard_MatchesSubdomain(string origin, string pattern, bool expected) =>
        CorsOriginMatcher.IsWildcardMatch(origin, pattern).Should().Be(expected);

    [Theory]
    [InlineData("https://example.com.ar", "https://example.com*", true)]
    [InlineData("https://example.com", "https://example.com*", true)]
    [InlineData("https://example.com:8080", "https://example.com*", true)]
    public void TrailingWildcard_MatchesSuffix(string origin, string pattern, bool expected) =>
        CorsOriginMatcher.IsWildcardMatch(origin, pattern).Should().Be(expected);

    [Fact]
    public void WildcardOnly_MatchesAnything() =>
        CorsOriginMatcher.IsWildcardMatch("https://literally-anything.com", "*").Should().BeTrue();

    [Theory]
    [InlineData("https://PR-42.azurewebapps.NET", "https://pr-*.azurewebapps.net", true)]
    [InlineData("HTTPS://PR-42.AZUREWEBAPPS.NET", "https://pr-*.azurewebapps.net", true)]
    public void Wildcard_IsCaseInsensitive(string origin, string pattern, bool expected) =>
        CorsOriginMatcher.IsWildcardMatch(origin, pattern).Should().Be(expected);
}
