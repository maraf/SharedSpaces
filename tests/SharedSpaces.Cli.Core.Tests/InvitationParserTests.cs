using SharedSpaces.Cli.Core;

namespace SharedSpaces.Cli.Core.Tests;

public class InvitationParserTests
{
    [Fact]
    public void Parse_RawInvitationString_ReturnsAllParts()
    {
        var result = InvitationParser.Parse("https://server.example.com|550e8400-e29b-41d4-a716-446655440000|123456");

        result.Should().NotBeNull();
        result!.ServerUrl.Should().Be("https://server.example.com");
        result.SpaceId.Should().Be("550e8400-e29b-41d4-a716-446655440000");
        result.Pin.Should().Be("123456");
    }

    [Fact]
    public void Parse_RawStringWithoutPin_ReturnsTwoPartsAndNullPin()
    {
        var result = InvitationParser.Parse("https://server.example.com|550e8400-e29b-41d4-a716-446655440000");

        result.Should().NotBeNull();
        result!.ServerUrl.Should().Be("https://server.example.com");
        result.SpaceId.Should().Be("550e8400-e29b-41d4-a716-446655440000");
        result.Pin.Should().BeNull();
    }

    [Fact]
    public void Parse_FullClientUrl_ExtractsInvitationFromQueryParam()
    {
        var url = "https://app.example.com/?join=https%3A%2F%2Fserver.example.com%7C550e8400-e29b-41d4-a716-446655440000%7C999999";

        var result = InvitationParser.Parse(url);

        result.Should().NotBeNull();
        result!.ServerUrl.Should().Be("https://server.example.com");
        result.SpaceId.Should().Be("550e8400-e29b-41d4-a716-446655440000");
        result.Pin.Should().Be("999999");
    }

    [Fact]
    public void Parse_HttpServerUrl_IsAccepted()
    {
        var result = InvitationParser.Parse("http://localhost:5000|550e8400-e29b-41d4-a716-446655440000|111111");

        result.Should().NotBeNull();
        result!.ServerUrl.Should().Be("http://localhost:5000");
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-url|not-a-guid|123")]
    [InlineData("ftp://server.com|550e8400-e29b-41d4-a716-446655440000|123")]
    [InlineData("https://server.com|invalid-guid|123")]
    [InlineData("https://server.com|550e8400-e29b-41d4-a716-446655440000|abc")]
    [InlineData("a|b|c|d")]
    public void Parse_InvalidInput_ReturnsNull(string input)
    {
        InvitationParser.Parse(input).Should().BeNull();
    }

    [Fact]
    public void Parse_UppercaseGuid_IsAccepted()
    {
        var result = InvitationParser.Parse("https://server.com|550E8400-E29B-41D4-A716-446655440000|123456");

        result.Should().NotBeNull();
        result!.SpaceId.Should().Be("550E8400-E29B-41D4-A716-446655440000");
    }
}
