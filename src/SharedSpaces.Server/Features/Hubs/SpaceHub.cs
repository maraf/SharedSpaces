using System.IdentityModel.Tokens.Jwt;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using SharedSpaces.Server.Features.Tokens;

namespace SharedSpaces.Server.Features.Hubs;

[Authorize]
public class SpaceHub : Hub
{
    public async Task JoinSpace(Guid spaceId)
    {
        var memberClaim = Context.User?.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
        if (!Guid.TryParse(memberClaim, out var memberId) || memberId == Guid.Empty)
        {
            throw new HubException("Invalid member ID in token");
        }

        var spaceClaim = Context.User?.FindFirst(SpaceMemberClaimTypes.SpaceId)?.Value;
        if (!Guid.TryParse(spaceClaim, out var claimedSpaceId))
        {
            throw new HubException("Invalid space ID in token");
        }

        if (claimedSpaceId != spaceId)
        {
            throw new HubException("Token space ID does not match requested space ID");
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, GetSpaceGroupName(spaceId));
    }

    private static string GetSpaceGroupName(Guid spaceId) => $"space:{spaceId}";
}
