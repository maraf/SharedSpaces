using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SharedSpaces.Server.Domain;

namespace SharedSpaces.Server.Infrastructure.Persistence.Configurations;

public class WebPushSubscriptionConfiguration : IEntityTypeConfiguration<WebPushSubscription>
{
    public void Configure(EntityTypeBuilder<WebPushSubscription> builder)
    {
        builder.ToTable("WebPushSubscriptions");

        builder.HasKey(subscription => subscription.Id);

        builder.Property(subscription => subscription.Id)
            .ValueGeneratedNever();

        builder.Property(subscription => subscription.Endpoint)
            .HasMaxLength(2000)
            .IsRequired();

        builder.Property(subscription => subscription.P256Dh)
            .HasMaxLength(256)
            .IsRequired();

        builder.Property(subscription => subscription.Auth)
            .HasMaxLength(256)
            .IsRequired();

        builder.Property(subscription => subscription.CreatedAt)
            .IsRequired();

        builder.Property(subscription => subscription.UpdatedAt)
            .IsRequired();

        builder.HasIndex(subscription => new { subscription.SpaceId, subscription.MemberId, subscription.Endpoint })
            .IsUnique();

        builder.HasIndex(subscription => subscription.SpaceId);
        builder.HasIndex(subscription => subscription.MemberId);

        builder.HasOne(subscription => subscription.Space)
            .WithMany(space => space.WebPushSubscriptions)
            .HasForeignKey(subscription => subscription.SpaceId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(subscription => subscription.Member)
            .WithMany(member => member.WebPushSubscriptions)
            .HasForeignKey(subscription => subscription.MemberId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
