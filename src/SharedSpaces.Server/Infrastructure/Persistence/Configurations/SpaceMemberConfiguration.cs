using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SharedSpaces.Server.Domain;

namespace SharedSpaces.Server.Infrastructure.Persistence.Configurations;

public class SpaceMemberConfiguration : IEntityTypeConfiguration<SpaceMember>
{
    public void Configure(EntityTypeBuilder<SpaceMember> builder)
    {
        builder.ToTable("SpaceMembers");

        builder.HasKey(member => member.Id);

        builder.Property(member => member.Id)
            .ValueGeneratedNever();

        builder.Property(member => member.DisplayName)
            .HasMaxLength(100)
            .IsRequired();

        builder.Property(member => member.JoinedAt)
            .IsRequired();

        builder.Property(member => member.IsRevoked)
            .HasDefaultValue(false)
            .IsRequired();

        builder.HasIndex(member => member.SpaceId);

        builder.HasOne(member => member.Space)
            .WithMany(space => space.Members)
            .HasForeignKey(member => member.SpaceId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
