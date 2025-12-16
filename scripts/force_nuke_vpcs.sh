#!/usr/bin/env bash
#
# force_nuke_vpcs.sh
# Complete teardown of all non-default VPCs in a given AWS region.
# Deletes orphaned ALBs, NATs, subnets, route tables, SGs, and finally VPCs.
#
# Usage:
#   ./force_nuke_vpcs.sh us-east-1
#
# ⚠️  WARNING: This irreversibly deletes *all* non-default networking resources.
#              Use only in disposable/dev environments.
#

set -euo pipefail

AWS_REGION="${1:-us-east-1}"

echo "🔍 Scanning for VPCs in region: ${AWS_REGION}"

VPCS=$(aws ec2 describe-vpcs --region "$AWS_REGION" \
  --query "Vpcs[?State=='available' && IsDefault==\`false\`].VpcId" \
  --output text)


if [[ -z "$VPCS" ]]; then
  echo "✅ No non-default VPCs found."
  exit 0
fi

for VPC_ID in $VPCS; do
  echo "💣 Cleaning up VPC: $VPC_ID"

  # --- Delete ALBs ---
  for LB_ARN in $(aws elbv2 describe-load-balancers --region "$AWS_REGION" \
      --query "LoadBalancers[?VpcId=='$VPC_ID'].LoadBalancerArn" --output text 2>/dev/null); do
      echo "  🧹 Deleting ALB: $LB_ARN"
      aws elbv2 delete-load-balancer --region "$AWS_REGION" --load-balancer-arn "$LB_ARN" || true
  done

  # --- Delete NAT Gateways ---
  for NAT_ID in $(aws ec2 describe-nat-gateways --region "$AWS_REGION" \
      --query "NatGateways[?VpcId=='$VPC_ID'].NatGatewayId" --output text 2>/dev/null); do
      echo "  🌐 Deleting NAT Gateway: $NAT_ID"
      aws ec2 delete-nat-gateway --region "$AWS_REGION" --nat-gateway-id "$NAT_ID" || true
  done

  # --- Delete Internet Gateways ---
  for IGW_ID in $(aws ec2 describe-internet-gateways --region "$AWS_REGION" \
      --query "InternetGateways[?Attachments[?VpcId=='$VPC_ID']].InternetGatewayId" --output text 2>/dev/null); do
      echo "  🔌 Detaching and deleting IGW: $IGW_ID"
      aws ec2 detach-internet-gateway --region "$AWS_REGION" --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID" || true
      aws ec2 delete-internet-gateway --region "$AWS_REGION" --internet-gateway-id "$IGW_ID" || true
  done

  # --- Delete Subnets ---
  for SUBNET_ID in $(aws ec2 describe-subnets --region "$AWS_REGION" \
      --query "Subnets[?VpcId=='$VPC_ID'].SubnetId" --output text 2>/dev/null); do
      echo "  🧱 Deleting Subnet: $SUBNET_ID"
      aws ec2 delete-subnet --region "$AWS_REGION" --subnet-id "$SUBNET_ID" || true
  done

  # --- Delete Route Tables (non-main only) ---
  for RTB_ID in $(aws ec2 describe-route-tables --region "$AWS_REGION" \
      --query "RouteTables[?VpcId=='$VPC_ID' && Associations[0].Main==null].RouteTableId" --output text 2>/dev/null); do
      echo "  🗺️ Deleting Route Table: $RTB_ID"
      aws ec2 delete-route-table --region "$AWS_REGION" --route-table-id "$RTB_ID" || true
  done

  # --- Delete Security Groups (excluding default) ---
  for SG_ID in $(aws ec2 describe-security-groups --region "$AWS_REGION" \
      --query "SecurityGroups[?VpcId=='$VPC_ID' && GroupName!='default'].GroupId" --output text 2>/dev/null); do
      echo "  🔒 Deleting Security Group: $SG_ID"
      aws ec2 delete-security-group --region "$AWS_REGION" --group-id "$SG_ID" || true
  done

  # --- Delete Network ACLs (excluding default) ---
  for ACL_ID in $(aws ec2 describe-network-acls --region "$AWS_REGION" \
      --query "NetworkAcls[?VpcId=='$VPC_ID' && IsDefault==\`false\`].NetworkAclId" --output text 2>/dev/null); do
      echo "  🚫 Deleting Network ACL: $ACL_ID"
      aws ec2 delete-network-acl --region "$AWS_REGION" --network-acl-id "$ACL_ID" || true
  done

  # --- Finally delete the VPC itself ---
  echo "  🧨 Deleting VPC: $VPC_ID"
  aws ec2 delete-vpc --region "$AWS_REGION" --vpc-id "$VPC_ID" || true

  echo "✅ Finished cleanup for $VPC_ID"
  echo
done

echo "🎉 All non-default VPCs have been removed in region ${AWS_REGION}."
