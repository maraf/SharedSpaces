using System.IdentityModel.Tokens.Jwt;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using SharedSpaces.Server.Infrastructure.Persistence;

namespace SharedSpaces.Server.Features.Tokens;

public static class JwtAuthenticationExtensions
{
    public static IServiceCollection AddJwtAuthentication(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                var signingKey = JwtTokenSigningKeyFactory.Create(configuration);
                options.MapInboundClaims = false;
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = signingKey,
                    ValidateIssuer = false,
                    ValidateAudience = false,
                    ValidateLifetime = false,
                    RequireExpirationTime = false,
                    NameClaimType = SpaceMemberClaimTypes.DisplayName
                };
            });

        services.AddAuthorization();

        return services;
    }

    public static IApplicationBuilder UseSpaceMemberAuthorization(this IApplicationBuilder app)
    {
        return app.UseMiddleware<SpaceMemberAuthorizationMiddleware>();
    }
}

internal sealed class SpaceMemberAuthorizationMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, AppDbContext db)
    {
        if (context.User.Identity?.IsAuthenticated != true)
        {
            await next(context);
            return;
        }

        var subject = context.User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
        if (!Guid.TryParse(subject, out var memberId))
        {
            await context.ChallengeAsync(JwtBearerDefaults.AuthenticationScheme);
            return;
        }

        var member = await db.SpaceMembers
            .AsNoTracking()
            .SingleOrDefaultAsync(existingMember => existingMember.Id == memberId);

        if (member == null || member.IsRevoked)
        {
            await context.ChallengeAsync(JwtBearerDefaults.AuthenticationScheme);
            return;
        }

        await next(context);
    }
}

internal static class SpaceMemberClaimTypes
{
    public const string DisplayName = "display_name";
    public const string ServerUrl = "server_url";
    public const string SpaceId = "space_id";
}

internal static class JwtTokenSigningKeyFactory
{
    public static SymmetricSecurityKey Create(IConfiguration configuration)
    {
        var signingKey = configuration["Jwt:SigningKey"] ?? throw new InvalidOperationException("Jwt:SigningKey not configured");
        var signingKeyBytes = Encoding.UTF8.GetBytes(signingKey);

        if (signingKeyBytes.Length < 32)
        {
            throw new InvalidOperationException("Jwt:SigningKey must be at least 256 bits.");
        }

        return new SymmetricSecurityKey(signingKeyBytes);
    }
}
