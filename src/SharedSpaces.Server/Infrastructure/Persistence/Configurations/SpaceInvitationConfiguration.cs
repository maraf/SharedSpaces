using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SharedSpaces.Server.Domain;

namespace SharedSpaces.Server.Infrastructure.Persistence.Configurations;

public class SpaceInvitationConfiguration : IEntityTypeConfiguration<SpaceInvitation>
{
    public void Configure(EntityTypeBuilder<SpaceInvitation> builder)
    {
        builder.ToTable("SpaceInvitations");

        builder.HasKey(invitation => invitation.Id);

        builder.Property(invitation => invitation.Id)
            .ValueGeneratedNever();

        builder.Property(invitation => invitation.Pin)
            .HasMaxLength(512)
            .IsRequired();

        builder.HasIndex(invitation => invitation.SpaceId);
        builder.HasIndex(invitation => invitation.Pin);

        builder.HasOne(invitation => invitation.Space)
            .WithMany(space => space.Invitations)
            .HasForeignKey(invitation => invitation.SpaceId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
