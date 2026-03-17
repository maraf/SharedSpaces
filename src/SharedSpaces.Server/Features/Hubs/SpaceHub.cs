using System.IdentityModel.Tokens.Jwt;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using SharedSpaces.Server.Features.Tokens;

namespace SharedSpaces.Server.Features.Hubs;

[Authorize]
public class SpaceHub : Hub
{
    public override async Task OnConnectedAsync()
    {
        var memberClaim = Context.User?.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
        if (!Guid.TryParse(memberClaim, out var memberId) || memberId == Guid.Empty)
        {
            throw new HubException("Invalid member ID in token");
        }

        var routeSpaceIdValue = Context.GetHttpContext()?.Request.RouteValues["spaceId"]?.ToString();
        if (!Guid.TryParse(routeSpaceIdValue, out var routeSpaceId) || routeSpaceId == Guid.Empty)
        {
            throw new HubException("Invalid space ID in hub route");
        }

        var spaceClaim = Context.User?.FindFirst(SpaceMemberClaimTypes.SpaceId)?.Value;
        if (!Guid.TryParse(spaceClaim, out var claimedSpaceId))
        {
            throw new HubException("Invalid space ID in token");
        }

        if (claimedSpaceId != routeSpaceId)
        {
            throw new HubException("Token space ID does not match requested space ID");
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, GetSpaceGroupName(routeSpaceId));
        await base.OnConnectedAsync();
    }

    public static string GetSpaceGroupName(Guid spaceId) => $"space:{spaceId}";
}
